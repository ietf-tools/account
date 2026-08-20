# CLAUDE.md

Brief for working in this repo. See [README.md](README.md) for the fuller narrative.

## What this is

A **headless, fully-custom front-end for [authentik](https://goauthentik.io)** — the public-facing
IETF Account UI (sign in, register, password reset, legacy migration). authentik is the identity
source of truth and runs separately; this app owns the entire UX by driving authentik's **Flow
Executor API** — **directly from the browser**. There is **no admin surface** and **no database**.

The app and authentik share one host in production (`account.ietf.org`), so the SPA calls authentik's
`/api/v3` **same-origin**: authentik's own cookies are set on and replayed by the browser, exactly as
its stock UI works. authentik therefore sees the real client IP/origin. The Fastify backend is **not**
in the auth path — it exists only for custom features that need the admin API token (legacy migration).

```
Browser ──► Nuxt SPA (frontend/) ──► authentik API      (all auth flows, same-origin)
                     └────────────► Fastify backend (backend/) ──► authentik admin API
                                                              └──► legacy Django system   (migration only)
```

## Stack & layout

- **Frontend:** Nuxt 4 SPA (`ssr: false`), Pinia, Tailwind. Source in `frontend/` (`srcDir`).
- **Backend:** Fastify (TypeScript, ESM, Node 26+), in-memory session. Source in `backend/`.
  **Not compiled** — Node runs the `.ts` files directly (it strips the types), so relative imports
  carry the real `.ts` extension and there is no build step or emitted output. `tsc` only
  type-checks (`npm run typecheck:backend`); see [backend/tsconfig.json](backend/tsconfig.json).
- Config: [nuxt.config.ts](nuxt.config.ts), [backend/lib/config.ts](backend/lib/config.ts) (env-driven).

```
backend/
  index.ts            Fastify bootstrap: CORS, cookie, session, static SPA, route registration
  tsconfig.json       Type-check only (noEmit) — see the note above
  lib/authentik.ts    Admin client (service-account token) + the AuthentikUser shape
  lib/config.ts       Env config (throws on missing SESSION_SECRET / AUTHENTIK_URL)
  lib/attributes.ts   Narrowing the free-form JSON in user `attributes` (it's all `unknown`)
  lib/errors.ts       errorMessage(): reading a message off a caught `unknown`
  lib/legacy.ts       Legacy Django client (migration only)
  routes/migration.ts Legacy → authentik account migration (the only auth-ish backend route)
frontend/
  components/FlowExecutor.vue  Dynamic authentik challenge renderer (the core UI)
  composables/useAuthentik.js  $fetch pointed at authentik /api/v3 (credentials + CSRF header)
  composables/useFlow.js       Drives one flow straight against authentik's executor
  composables/useApi.js        $fetch pointed at the app backend (migration only)
  utils/authentik.js           toSessionUser, source-URL resolution, isFlowComplete
  stores/auth.js               Pinia session store (resolves the user via /core/users/me/)
  pages/                       login, register, recover, migrate, index (protected)
  layouts/default.vue          Centered card, IETF logo + glows, no header bar
  middleware/auth.js           Route guard; plugins/auth.client.js resolves session on boot
```

## Core model: driving the Flow Executor from the browser

authentik has no traditional "login API". Every flow (authentication/enrollment/recovery) is a state
machine of **challenges** (JSON keyed by `component`, e.g. `ak-stage-identification`,
`ak-stage-password`). [useFlow.js](frontend/composables/useFlow.js) `GET`s the executor to begin and
`POST`s to advance — **directly against authentik** via [useAuthentik.js](frontend/composables/useAuthentik.js)
(`credentials: 'include'`, plus the `X-authentik-CSRF` header echoed from the `authentik_csrf` cookie).
The flow's cookies live in the browser — there is no server-side jar.
[FlowExecutor.vue](frontend/components/FlowExecutor.vue) renders each challenge, collects input, and
submits. Completion = the terminal `xak-flow-redirect`; the SPA then resolves the user via
`/core/users/me/` and keeps a trimmed record in the Pinia store.

**Adding UI for a new stage:** add a branch in FlowExecutor's template keyed on `component`.
Unhandled stages render a labelled fallback (never a dead end), so the app degrades gracefully.

**Restarting a flow ("Not you?"):** authentik holds the in-progress plan in its session (keyed by the
browser cookie), so a bare executor `GET` *resumes* mid-flow rather than starting over. `begin()` in
[useFlow.js](frontend/composables/useFlow.js) therefore first hits authentik's `CancelView`
(`/flows/-/cancel/`, a sibling of `/api/v3` — see `flowsCancelUrl`) to discard the plan, then GETs the
first challenge. There is no executor query-param for this. (The old BFF got this for free by using a
fresh cookie jar per `begin`.)

## Gotchas (read before changing auth)

- **Invariant: the browser talks to authentik's Flow Executor directly; the backend never proxies
  auth.** This works because the app and authentik are same-origin in prod (`account.ietf.org`, app
  under `/app/`, authentik API at `/api/v3`). The backend (`backend/`) is **only** for features that
  need the admin token — currently just migration. Don't route auth flows back through it.
- **CSRF:** authentik/Django checks Origin/Referer (the browser sets these, same-origin ⇒ OK) and
  expects the `authentik_csrf` cookie echoed as `X-authentik-CSRF` on unsafe methods —
  [useAuthentik.js](frontend/composables/useAuthentik.js) does this in `onRequest`. This relies on
  authentik's `authentik_csrf` cookie being JS-readable (not `HttpOnly`), which is its default.
- **Social / source logins** (FlowExecutor `continueWithSource`, [login.vue](frontend/pages/login.vue)):
  buttons come from `challenge.sources` on the identification stage; [utils/authentik.js](frontend/utils/authentik.js)
  `withSources` rewrites them to absolute `url`/`icon_url` client-side. Clicking does a full-page
  redirect to authentik with `?next=…/login?social=return`. On return, login.vue simply calls
  `/core/users/me/` — the browser already holds authentik's session cookie (same host), so there's
  nothing to "finalize" server-side. It **cannot complete in local dev** (frontend on `localhost`,
  authentik remote — the cross-site session cookie won't stick).
- **Deployment mount:** app runs under **`/app/`** on `account.ietf.org`; authentik owns the domain
  root (including `/api`). Hence `app.baseURL='/app/'` and the app's own API is at **`/app/api`**
  (not `/api`, to avoid colliding with authentik). The reverse proxy must route `/app/*` to this
  app's backend and **strip the `/app` prefix** (backend still serves `/api` + static at root).
  authentik keeps serving `/api/v3` at the root, which is what the SPA hits directly.
  Overridable via `NUXT_APP_BASE_URL` / `NUXT_PUBLIC_API_URL` / `NUXT_PUBLIC_AUTHENTIK_API_URL`.
- **Local dev** (`npm run dev`): the browser is on `localhost:3000`, so Nuxt's `devProxy`
  ([nuxt.config.ts](nuxt.config.ts)) forwards `/api/v3` → the remote `AUTHENTIK_URL` (and `/app/api` →
  the backend) to keep everything same-origin. Password/enrollment/recovery flows work; **social
  login can't complete in dev**, and if authentik sets `Secure` cookies they won't stick over
  `http://localhost` — test full sign-in against the deployed same-host environment.
- **Captcha stage** (`ak-stage-captcha`, on both the manual and the social enrollment flow): the challenge carries the
  provider's `js_url` + public `site_key` (Cloudflare Turnstile), and is satisfied by POSTing the
  solved `{ token }`. [CaptchaStage.vue](frontend/components/CaptchaStage.vue) injects that script
  (once per URL, page lifetime), renders the widget explicitly, and emits the token;
  [FlowExecutor.vue](frontend/components/FlowExecutor.vue) submits it immediately and renders **no**
  Continue button. Auto-submitting means a persistently rejected token would loop, so it's capped at
  3 attempts. Being a third-party script, it needs the provider's CDN reachable (ad-blockers break
  it) and the site key's **allowed domains must include `localhost`** to exercise it in dev.
- **Note Well agreement: a prompt checkbox's `required` is not a gate.** Both enrollment flows carry a
  prompt stage (one checkbox, notice text + links in its **label**) bound right before the captcha —
  see [ietf-note-well-consent.yaml](authentik/ietf-flows/ietf-note-well-consent.yaml). authentik builds
  every checkbox prompt as a `BooleanField(required=False)`, so an unticked box is a *valid* response
  no matter what the prompt's `required` flag says: the stage's **validation policy** is what rejects
  it (failure lands in `non_field_errors`, which FlowExecutor already renders). FlowExecutor blocks
  submit for required-but-unticked checkboxes too (`validatePrompt`) — that's the inline message, not
  the gate. Prompt labels are rendered as markup (`richLabel`), which rewrites anchors to `_blank` so
  a link can't navigate the flow away; inside a `<label>` those links don't toggle the box (the HTML
  spec skips label activation for interactive descendants). Recording the answer takes a *second*
  policy on each flow's **user write binding** (same trick as `ietf-enrollment-set-username-from-email`):
  keys it injects into `prompt_data` as `attributes.…` are written to `user.attributes`, dotted paths
  nesting — the checkbox's own bare key is discarded by the write stage. Hence the stage must be bound
  before user write, and that policy must return `True` unconditionally (a stage binding policy
  returning `False` *skips* the stage — here, no account).
- **New-account defaults are stamped by a policy on the enrollment *user write* binding** —
  [ietf-enrollment-account-defaults.yaml](authentik/ietf-flows/ietf-enrollment-account-defaults.yaml)
  seeds `attributes.recovery_emails = []` and `attributes.avatar` = the Gravatar URL for the signed-up
  address (same MD5 recipe as [backend/lib/gravatar.ts](backend/lib/gravatar.ts), because
  `attributes.avatar` is *always* a URL — see [backend/routes/avatar.ts](backend/routes/avatar.ts)).
  Same `attributes.…`-into-`prompt_data` mechanism as the note-well recorder above; like it, the
  policy must return `True` unconditionally, or the write stage is skipped and no account is created.
- **"Stay signed in" (`ak-stage-user-login`) is coupled to server config.** The user login stage runs
  headlessly *unless* its `remember_me_offset` is non-zero, in which case it emits a challenge that
  **requires** a `remember_me` boolean back (session then lasts `session_duration + remember_me_offset`;
  with `session_duration: seconds=0`, "no" means a browser-session cookie). It arrives *last*, after
  password/MFA, so a checkbox on the sign-in form can't ride along: FlowExecutor keeps the answer in
  `rememberMe`, set by the checkbox on `ak-stage-password`, and auto-submits it (`autoRemembering`
  suppresses the flash, and a rejected silent answer falls through to the visible card rather than
  looping). That checkbox is **ticked by default** — password managers autofill *and* submit, so an
  unticked box is frequently never seen. Flows with no password stage — social callback, enrollment, recovery — render the visible
  "Stay signed in?" card instead, so the choice is never a silent default. Set the offset on **every**
  flow ending in a user login stage or behavior varies by sign-in method. Note authentik only writes the
  `remember_device` known-device cookie on the headless path (`if remember is None`), so enabling the
  offset disables it. Don't confuse any of this with the identification stage's `enable_remember_me`,
  which is only a localStorage username prefill in authentik's stock UI and is ignored here.
- **One stage, one POST — and never route out of a completed flow without a user.** Password managers
  autofill *and submit*, so a stage can be answered twice (a disabled Continue button doesn't stop an
  Enter keypress in a field); the duplicate reaches authentik after the plan has advanced and answers
  the wrong stage. [useFlow.js](frontend/composables/useFlow.js) drops a `submit` while one is in
  flight and stamps every request with a `generation` so a late response can't be applied over a newer
  one — that clobbering is what once left the completed flow's `user` null while `complete` stayed
  true: the consumer's completion watcher is one-shot, so nothing ever redirected and login sat on
  "Signed in — redirecting…". `resolveUser` also maps authentik's AnonymousUser to `null` (a terminal
  `xak-flow-redirect` is not proof of a session — a non-applicable flow ends the same way). Pages
  therefore must treat a null user as "resolve the session yourself" ([login.vue](frontend/pages/login.vue),
  [social-callback.vue](frontend/pages/social-callback.vue), [verify-email.vue](frontend/pages/verify-email.vue)):
  pushing an unauthenticated browser at a guarded route makes the middleware bounce it to `/login`,
  and when that IS the current route Vue Router silently drops the navigation — a dead end with no
  error on screen.
- **`autofocus` does not fire** on SPA navigation or Vue stage swaps. Focus programmatically instead —
  FlowExecutor focuses the first field on every `challenge` change (`focusFirstField` + `formEl` ref);
  migrate.vue focuses on mount via a ref. Follow this pattern for new focusable steps.
- **Client-side validation** lives in FlowExecutor (`validateIdentification`): empty/invalid email is
  blocked before submit and shown inline; server-side field errors come from `response_errors`.
- **Identity = authentik's session**, resolved live via `/core/users/me/` on boot
  ([stores/auth.js](frontend/stores/auth.js)); there's no app-side login session, so a backend restart
  does *not* log anyone out. The backend's in-memory session (cookie `sessionId`) now holds **only**
  the legacy migration's two-step handoff; multi-instance would still want a shared store there.
- **Blocked email domains live in three places, and only two of them are gates.**
  `BLOCKED_EMAIL_DOMAINS` (default `ietf.org`; hostnames matched **exactly** — subdomains are not
  implied, since `staff.ietf.org` and friends are real personal mailboxes) is read by
  [backend/lib/config.ts](backend/lib/config.ts) *and* [nuxt.config.ts](nuxt.config.ts), so one env var
  drives the backend refusals (recovery addresses, verified email change — matching in
  [backend/lib/email-domains.ts](backend/lib/email-domains.ts)) and the SPA's inline warning
  ([frontend/utils/emailDomains.js](frontend/utils/emailDomains.js), a hand-kept twin of that matcher).
  **Registration is gated by neither** — the browser drives the enrollment flows straight against
  authentik, so that gate is an authentik policy with its own copy of the list
  ([ietf-blocked-email-domains.yaml](authentik/ietf-flows/ietf-blocked-email-domains.yaml)); adding a
  domain means editing the `.env` *and* that policy. The policy is bound two ways because the two
  flows differ: a **validation policy** on manual enrollment's prompt stage (the user typed the
  address and can fix it — the message lands in `non_field_errors`), and a **Deny stage** on social
  enrollment (the address came from the provider, so there's nothing to correct). Its expression
  answers *"is this allowed?"*, not *"is this blocked?"*, because a prompt stage's
  `validation_policies` are run by a `ListPolicyEngine` that builds its own transient bindings —
  `negate` on a PolicyBinding is ignored there. The deny stage's binding carries `negate: true` to
  read it the other way. Email *change* is blocked too, or the registration block is a formality
  (sign up with a personal address, then move the account over).
- **The user-settings email guard is fixed in authentik, not here — the client cannot work around it.**
  The `ietf-user-settings` prompt stage has authentik's stock validation policy attached, whose email
  branch is `if prompt_data.get("email") != request.user.email: reject("Not allowed to change email
  address.")` — with **no default** (unlike the sibling username branch, `prompt_data.get("username",
  request.user.username)`). Since the email field was removed from the stage (email is owned by the
  verified email-change flow — [profile.vue](frontend/pages/account/profile.vue) + backend),
  `prompt_data` never carries email, so the guard sees `None`, treats it as a change, and rejects every
  save. Injecting `email` from the client does **not** help: the prompt serializer discards any POST key
  that isn't a declared stage field, so it never reaches `prompt_data`. **Fix = edit that authentik
  policy** so the email line mirrors the username line: `prompt_data.get("email", request.user.email)`
  (or drop the email block, or re-add a hidden `email` field whose initial value is `request.user.email`).
- **Per-user "disable GitHub sign-in" is enforced by an authentik policy, not by this app.**
  [connected.vue](frontend/pages/account/connected.vue) → `POST /github/login-disabled`
  ([backend/routes/github.ts](backend/routes/github.ts)) only writes
  `attributes.github.login_disabled` with the admin token; the flag does nothing until an expression
  policy on a **Deny stage** in the source authentication flow (`ietf-social-callback`, ordered before
  its user-login stage, `evaluate_on_plan: true`) reads it — the expression is in that route's header
  comment. It works because the three source paths differ: **linking runs no flow at all**
  (`SourceFlowManager.handle_existing_link`), so the policy can block sign-in without touching the
  link. Use a Deny stage, not a flow-root policy binding — a root denial raises
  `FlowNonApplicableException` (generic authentik error page) instead of the `ak-stage-access-denied`
  challenge FlowExecutor already renders. That flow is shared by all three sources, so the expression
  must check the source slug. Disconnecting clears the flag first (it requires a live connection), or
  it would outlive the link and silently block a later reconnect.
- **Admin API token** (`AUTHENTIK_API_TOKEN`) is needed by every backend feature that writes or reads
  what the browser can't — migration, avatar/portrait, email change, and the GitHub attributes above
  (`/core/users/me/` omits `attributes` entirely). It is **never** in the auth path.

## Conventions

- **No single-line `if`/`for`** — always use expanded block bodies with braces.
- Shared styles are Tailwind `@layer components` classes in
  [frontend/assets/css/main.css](frontend/assets/css/main.css): `.btn-primary`, `.btn-social`
  (bevel/elevation), `.field-input`, `.field-label`, `.card`, `.link`. Primary color is **sky**.

## Commands

```bash
npm run dev:backend      # Fastify on :4000 (node --watch, runs the .ts sources directly)
npm run dev:frontend     # Nuxt dev on :3000, proxies the API path → backend
npm run build            # nuxt generate → .output/public (base /app/)
npm start                # Fastify serves API + built SPA (same origin)
npm run lint             # oxlint
npm run typecheck:backend  # tsc -p backend (type-check only, no emit)
```

**Verify a frontend change** with `npm run build:frontend` (used throughout this project as the quick
compile check). **Verify a backend change** with `npm run typecheck:backend` — nothing else compiles
the backend, so a type error only shows up here or at run time. Both require a local `.env` (copy
`.env.sample`); config throws on missing required vars.
