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
- **Backend:** Fastify (ESM, Node 26+), in-memory session. Source in `backend/`.
- Config: [nuxt.config.ts](nuxt.config.ts), [backend/lib/config.js](backend/lib/config.js) (env-driven).

```
backend/
  index.js            Fastify bootstrap: CORS, cookie, session, static SPA, route registration
  lib/authentik.js    Admin client (service-account token) — used only by migration
  lib/config.js       Env config (throws on missing SESSION_SECRET / AUTHENTIK_URL)
  lib/legacy.js       Legacy Django client (migration only)
  routes/migration.js Legacy → authentik account migration (the only auth-ish backend route)
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
- **"Stay signed in" (`ak-stage-user-login`) is coupled to server config.** The user login stage runs
  headlessly *unless* its `remember_me_offset` is non-zero, in which case it emits a challenge that
  **requires** a `remember_me` boolean back (session then lasts `session_duration + remember_me_offset`;
  with `session_duration: seconds=0`, "no" means a browser-session cookie). It arrives *last*, after
  password/MFA, so a checkbox on the sign-in form can't ride along: FlowExecutor keeps the answer in
  `rememberMe`, set by the checkbox on `ak-stage-password`, and auto-submits it (`autoRemembering`
  suppresses the flash, and a rejected silent answer falls through to the visible card rather than
  looping). Flows with no password stage — social callback, enrollment, recovery — render the visible
  "Stay signed in?" card instead, so the choice is never a silent default. Set the offset on **every**
  flow ending in a user login stage or behavior varies by sign-in method. Note authentik only writes the
  `remember_device` known-device cookie on the headless path (`if remember is None`), so enabling the
  offset disables it. Don't confuse any of this with the identification stage's `enable_remember_me`,
  which is only a localStorage username prefill in authentik's stock UI and is ignored here.
- **`autofocus` does not fire** on SPA navigation or Vue stage swaps. Focus programmatically instead —
  FlowExecutor focuses the first field on every `challenge` change (`focusFirstField` + `formEl` ref);
  migrate.vue focuses on mount via a ref. Follow this pattern for new focusable steps.
- **Client-side validation** lives in FlowExecutor (`validateIdentification`): empty/invalid email is
  blocked before submit and shown inline; server-side field errors come from `response_errors`.
- **Identity = authentik's session**, resolved live via `/core/users/me/` on boot
  ([stores/auth.js](frontend/stores/auth.js)); there's no app-side login session, so a backend restart
  does *not* log anyone out. The backend's in-memory session (cookie `sessionId`) now holds **only**
  the legacy migration's two-step handoff; multi-instance would still want a shared store there.
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
- **Admin API token** (`AUTHENTIK_API_TOKEN`) is used **only** by the migration flow, not normal auth.

## Conventions

- **No single-line `if`/`for`** — always use expanded block bodies with braces.
- Shared styles are Tailwind `@layer components` classes in
  [frontend/assets/css/main.css](frontend/assets/css/main.css): `.btn-primary`, `.btn-social`
  (bevel/elevation), `.field-input`, `.field-label`, `.card`, `.link`. Primary color is **sky**.

## Commands

```bash
npm run dev:backend      # Fastify on :4000 (node --watch)
npm run dev:frontend     # Nuxt dev on :3000, proxies the API path → backend
npm run build            # nuxt generate → .output/public (base /app/)
npm start                # Fastify serves API + built SPA (same origin)
npm run lint             # oxlint
```

**Verify a frontend change** with `npm run build:frontend` (used throughout this project as the quick
compile check). Requires a local `.env` (copy `.env.sample`); config throws on missing required vars.
