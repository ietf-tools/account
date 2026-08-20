<div align="center">

<img src="https://static.ietf.org/logos/icon-account.svg" alt="IETF Account" height="125" />

# IETF Account

[![Release](https://img.shields.io/github/release/ietf-tools/account.svg?style=flat&maxAge=300)](https://github.com/ietf-tools/account/releases)
[![License](https://img.shields.io/github/license/ietf-tools/account)](https://github.com/ietf-tools/account/blob/main/LICENSE)
![Node Version](https://img.shields.io/badge/node.js-26-green?logo=node.js&logoColor=white)
![Vue Version](https://img.shields.io/badge/vue-3-green?logo=vue.js&logoColor=white)

##### A fully custom, headless front-end for [authentik](https://goauthentik.io)

</div>

Authentik runs in the background as the identity source of truth; this app owns
the entire public-facing user experience (sign in, register, password reset,
legacy account migration) by driving authentik's **Flow Executor API** **directly
from the browser**. There is no admin surface here — admins use the authentik
admin interface directly.

## Architecture

```
Browser ──► Nuxt SPA (frontend/) ──► authentik API            (all auth flows, same-origin)
                     └────────────► Fastify backend (backend/) ──► authentik admin API
                                                            └────► legacy Django system  (migration only)
```

The app and authentik **share one host** in production (`account.ietf.org`, app
under `/app/`, authentik at the domain root). The SPA therefore calls authentik's
`/api/v3` **same-origin**: authentik's own cookies are set on and replayed by the
browser, exactly as its stock UI works. The Fastify backend is **not in the auth
path** — it exists only for custom features that need the admin API token
(currently just legacy migration).

- **No database.** authentik holds all identity state. Identity is resolved live
  via `/core/users/me/` on boot ([`frontend/stores/auth.js`](frontend/stores/auth.js)),
  so there's no app-side login session and a backend restart logs no one out. The
  backend keeps only a small **in-memory session** for the migration flow's
  two-step handoff; a multi-instance deployment would want a shared store there.
- **Browser-driven auth.** The frontend talks to authentik's Flow Executor
  itself — the backend never proxies auth. It `GET`s the executor to begin a
  flow, renders whatever *challenge* comes back, and `POST`s the user's input to
  advance, all directly against authentik. See
  [`frontend/composables/useFlow.js`](frontend/composables/useFlow.js) and
  [`frontend/composables/useAuthentik.js`](frontend/composables/useAuthentik.js).
- **Custom backend logic** (e.g. legacy migration) lives in dedicated routes and
  libs, not in authentik. See [`backend/routes/migration.ts`](backend/routes/migration.ts)
  and [`backend/lib/legacy.ts`](backend/lib/legacy.ts).

### How a login works

Every authentik flow is a state machine of **challenges** (JSON keyed by
`component`, e.g. `ak-stage-identification`, `ak-stage-password`):

1. [`useFlow.js`](frontend/composables/useFlow.js) `GET`s authentik's Flow
   Executor to begin, returning the first challenge (`ak-stage-identification`).
2. [`FlowExecutor.vue`](frontend/components/FlowExecutor.vue) renders the stage.
   User submits → the composable `POST`s the input straight back to the executor.
3. Repeat for each stage (password, MFA, prompts…) until authentik returns the
   terminal `xak-flow-redirect`. The SPA then resolves the user via
   `/core/users/me/` and keeps a trimmed record in the Pinia store.

The same executor bridge drives **enrollment** (register) and **recovery**
(password reset) — only the flow slug differs. Requests carry authentik's cookies
(`credentials: 'include'`) plus the `X-authentik-CSRF` header echoed from the
`authentik_csrf` cookie; [`useAuthentik.js`](frontend/composables/useAuthentik.js)
adds both. Restarting a flow ("Not you?") first hits authentik's cancel view
(`/flows/-/cancel/`) to discard the in-progress plan, since a bare executor `GET`
otherwise *resumes* mid-flow.

### Social / source logins

authentik's configured login **sources** (OAuth/SAML — e.g. Apple, GitHub,
Google) ride along on the `ak-stage-identification` challenge, so the login page
renders them as a row of buttons under the email field with **no per-provider
config here** — enable them in authentik and they appear.

OAuth can't be driven like a password stage: the browser has to leave this app
for authentik (and on to the provider) and come back. So the buttons do a
full-page redirect to the source's login URL with a `next` that returns to
`/app/login?social=return`. authentik authenticates the user and — because this
app is **same-origin** with authentik (`account.ietf.org`) — sets its session
cookie right where the browser already is. On return, [`login.vue`](frontend/pages/login.vue)
simply calls `/core/users/me/`; the cookie is already present, so there's nothing
to finalize server-side.

**Interactive returns.** After the provider round-trip authentik runs the source's
callback flow (`ietf-social-callback`). Most of the time it finishes
non-interactively and redirects straight to the `next` above — but a first-time
sign-in (enrollment), account linking, or a missing required attribute makes it
render an interactive stage, which authentik would show in its own UI at
`/if/flow/ietf-social-callback/`. **Rule 6** intercepts that to
`/app/social-callback`, where [`social-callback.vue`](frontend/pages/social-callback.vue)
drives the flow through `FlowExecutor` **in resume mode** (the source callback
built the plan — cancelling would drop the in-progress login). On completion the
flow redirects to its `next` (`/app/login?social=return`), so it rejoins the
finalize path above; if there's no `next`, the page resolves the user itself.

**First-time sign-ups.** A brand-new user's return additionally runs the source
*enrollment* flow (`ietf-social-enrollment`) to create the account. **Rule 7**
sends `/if/flow/ietf-social-enrollment/` to `/app/social-enrollment`, where
[`social-enrollment.vue`](frontend/pages/social-enrollment.vue) drives it through
`FlowExecutor` **in resume mode** (same reasoning as the callback flow) under a
"Finalizing your account creation" heading, following the terminal redirect back
to `next` — again rejoining the finalize path. Usually there's nothing to render:
the first challenge *is* that redirect, so the screen just flashes by. But the
flow can carry interactive stages — notably the **captcha** gating account
creation — and those render there like on any other flow page.

> This shared-host assumption is what makes the hand-off work. In local dev
> (frontend on `localhost:3000`, authentik remote) the cross-site session cookie
> won't stick, so exercise social login (and its interactive callback) against a
> same-host deployment.

### Note Well agreement (both enrollment paths)

Every new account — whether it came from the sign-up form (`ietf-enrollment`) or
from a first social sign-in (`ietf-social-enrollment`) — has to agree to follow
IETF processes and policies (the [Note Well](https://www.ietf.org/about/note-well/)
and the [Privacy Statement](https://www.ietf.org/privacy-statement/)) before the
account is created. That's a **prompt stage carrying a single checkbox**, bound to
both flows immediately before their captcha stage. The notice text — links included
— lives in the prompt's label in authentik, not in this app:
[`FlowExecutor.vue`](frontend/components/FlowExecutor.vue) renders prompt labels as
markup and forces links inside them to open in a new tab, so reading the Note Well
doesn't abandon the flow.

A checkbox prompt's `required` flag does **not** make authentik insist on a ticked
box (it builds every checkbox as a serializer field with `required=False`, so
`false` is a valid answer), so the stage carries a **validation policy** that
rejects an unticked one — that policy is the gate. The app also blocks submit
client-side for the inline message. A second expression policy, on each flow's user
write binding, stamps the agreement onto the account being created:
`attributes.note_well.agreed` plus an ISO 8601 `attributes.note_well.agreed_at`.

All of it — prompt, both policies, stage, bindings — is in
[`authentik/ietf-flows/ietf-note-well-consent.yaml`](authentik/ietf-flows/ietf-note-well-consent.yaml),
whose header explains the one value you must set per instance: the binding `order`,
which has to place the stage before the captcha (and so before the user write
stage, or the account exists before anyone agreed).

> Accounts crossing over from the legacy Django system don't run an enrollment flow
> at all — [`backend/routes/migration.ts`](backend/routes/migration.ts) creates them
> with the admin API — so this stage never fires for them.

### Email confirmation (manual enrollment)

A manually created account gets a confirmation email whose link points at
`/if/flow/ietf-enrollment/?<token>`. authentik's email stage would consume that
token on the **GET** — so an email client that pre-fetches the link (Outlook,
Microsoft Defender) verifies the account before the user ever clicks. The
enrollment flow guards against that with an interactive confirmation stage before
the token is consumed: the token only advances on a **POST**.

**Rule 8** intercepts the link to `/app/verify-email`, where
[`verify-email.vue`](frontend/pages/verify-email.vue) drives the enrollment flow
through `FlowExecutor` **in resume mode**, forwarding the token (the preserved
querystring) so authentik restores the pending enrollment and renders the
confirmation. The user clicks continue → the POST completes the flow. This is
doubly pre-fetch-safe: the token advances only on the explicit POST, **and**
because the SPA needs JavaScript to call the executor at all, a plain link
pre-fetch (which doesn't run JS) never reaches authentik. The flow ends on a
`User Login` stage, so the browser is signed in on completion; the page opts out of
authentik's terminal redirect (`:follow-redirect="false"` — its `to` only points
into authentik's own user UI), resolves the session itself, and routes into the
signed-in area (falling back to sign-in if the flow didn't authenticate).

> The confirmation is an `ak-stage-consent` challenge (authentik's generic "confirm
> to proceed" step). It is **not** a stage in the flow's bindings — authentik injects
> it whenever a flow is resumed from an email-link token, as a resume guard. Here
> that guard is exactly what we want (the user must click to confirm the email), so
> `FlowExecutor` renders it through `verify-email.vue`'s `consent` slot (whose copy names
> the address being confirmed — the challenge's `pending_user`) and
> echoes the challenge's required `token` back on submit. (Recovery injects the same
> consent but suppresses it — see "Password reset" below.) If your flow surfaces a
> different component, add a branch in
> [`FlowExecutor.vue`](frontend/components/FlowExecutor.vue) — an unhandled stage
> still renders a labelled fallback rather than dead-ending.

### Password reset (forgot password)

The "forgot password" flow (`ietf-recovery`) starts on [`recover.vue`](frontend/pages/recover.vue),
which drives the executor headlessly to collect the email and trigger authentik's
recovery email. That email's link points at `/if/flow/ietf-recovery/?<token>` —
which by default renders authentik's own flow UI for choosing a new password.

**Rule 9** intercepts that link to `/app/reset-password`, where
[`reset-password.vue`](frontend/pages/reset-password.vue) drives the recovery flow
through `FlowExecutor` **in resume mode**, forwarding the token (the preserved
querystring) so authentik restores the pending recovery and renders the "set a new
password" stage (an `ak-stage-prompt` carrying the password fields) in our own UI.
The user picks a new password → the POST advances the flow. Like the enrollment
link this is pre-fetch-safe: the token is consumed only as the flow advances on the
POST, **and** the SPA needs JavaScript to reach the executor at all.

> Resuming from the token surfaces an `ak-stage-consent` ("… is requesting access …")
> before the password prompt — the same consent authentik injects on any token
> resume (it's **not** in `ietf-recovery`'s stage bindings; see the enrollment note
> above). Unlike enrollment we don't need it as a resume guard here — the password
> prompt is itself the interactive gate — so `reset-password.vue` passes
> `:auto-consent="true"` and `FlowExecutor` submits that consent programmatically,
> dropping the user straight onto the password form. (`auto-consent` is strictly
> opt-in: real OAuth access-consent on login stays an explicit click.)

The recovery
flow ends on a `User Login` stage, so the browser is signed in on completion; the
page opts out of authentik's terminal redirect (`:follow-redirect="false"`),
resolves the session itself, and routes into the signed-in area (falling back to
sign-in if the flow didn't authenticate).

> No authentik-side change is needed: the recovery email keeps authentik's default
> link to `/if/flow/ietf-recovery/`, and Rule 9 is what brings it into this app.

### Change email address

A signed-in user changes their email through the **backend** (`backend/routes/email-change.ts`),
**not** an authentik flow. authentik's Email stage can't cleanly send a verification
to an as-yet-unsaved address in a self-service flow (it has no pending user to send
to, and policy-injected context doesn't reliably propagate), so this is a
backend-only feature — like migration and passwordless, it uses the service-account
admin token to write the user. It's two steps:

1. **Request + send** — the "Change email" form on
   [`profile.vue`](frontend/pages/account/profile.vue) `POST`s the new address to
   `/api/email-change`. The backend resolves the caller from their authentik session
   cookie (never a browser-sent pk), checks the address isn't already in use, stores
   it on `attributes.pending_email`, and emails a **signed, time-limited token**
   (HMAC over `{pk, newEmail, exp}`, keyed by `SESSION_SECRET` — see
   [`backend/lib/token.ts`](backend/lib/token.ts)) as a link to the **new** address
   (via [`backend/lib/mailer.ts`](backend/lib/mailer.ts), SMTP).
2. **Confirm + write** — the link points at `/app/verify-email-change?token=…`, a
   normal app route (no Cloudflare rule needed).
   [`verify-email-change.vue`](frontend/pages/verify-email-change.vue) shows a
   **Confirm** button; clicking it `POST`s the token to `/api/email-change/verify`.
   The backend validates the token, confirms `attributes.pending_email` still matches
   (making it single-use — a replay after the change can't re-fire), then writes
   `email` **and** `username` together (kept identical; safe because every OAuth
   provider derives `sub` from the hashed user ID, which a username change doesn't
   affect) and clears the pending marker.

**Pre-fetch-safe** the same way as the email links above: a bare GET of the link only
renders the SPA, and the change is applied only on the explicit Confirm POST — which
needs JavaScript to fire, so a mail scanner (Outlook, Microsoft Defender) can't
trigger it. The token authorises the change, so the link also works on a device where
the browser isn't signed in; on success the page routes to `/app/profile?changed=1`,
which shows the confirmation banner and refreshes the session.

> Requires SMTP configured for the backend (`SMTP_*` in `.env`) and `PUBLIC_APP_URL`
> for building the link. No authentik flow, prompt, policy, or Cloudflare rule is
> involved — the service account behind `AUTHENTIK_API_TOKEN` just needs user
> change permission (which migration already relies on).

## Project layout

```
backend/                (only for features that need the admin token — not auth)
  index.ts              Fastify bootstrap: CORS, cookies, session, static SPA, routes
  tsconfig.json         Type-check only (noEmit) — Node runs the .ts sources as they are
  lib/
    config.ts           Env-driven config (throws on missing SESSION_SECRET / AUTHENTIK_URL)
    authentik.ts        Admin client (service-account token) + the AuthentikUser shape
    attributes.ts       Narrowing the free-form JSON in user `attributes`
    errors.ts           errorMessage(): reading a message off a caught `unknown`
    legacy.ts           Legacy Django client (migration only) — swap for your transport
  routes/
    migration.ts        Legacy → authentik account migration (the only auth-ish route)
    health.ts
frontend/
  app.vue, layouts/, pages/     login, register, recover, migrate, index (protected)
  components/
    FlowExecutor.vue    Dynamic authentik challenge renderer (the core UI)
    NetworkBackground.vue
  composables/
    useAuthentik.js     $fetch pointed at authentik /api/v3 (credentials + CSRF header)
    useFlow.js          Drives one flow straight against authentik's executor
    useApi.js           $fetch pointed at the app backend (migration only)
  utils/authentik.js    toSessionUser, source-URL resolution, isFlowComplete
  stores/auth.js        Pinia session store (resolves the user via /core/users/me/)
  middleware/auth.js    Route guard
  plugins/auth.client.js  Resolves session on boot
nuxt.config.ts          SPA config; dev-proxies /api/v3 → authentik, /app/api → backend
```

## Getting started

Requires **Node.js 26+** — the backend is TypeScript and is never compiled, so it
relies on Node running `.ts` files directly (type stripping). The included dev
container provides it.

```bash
cp .env.sample .env      # then fill in AUTHENTIK_URL, SESSION_SECRET, etc.
npm install
```

Run the two processes in separate terminals:

```bash
npm run dev:backend      # Fastify on http://localhost:4000 (runs the .ts sources directly)
npm run dev:frontend     # Nuxt on   http://localhost:3000
```

Nothing compiles the backend, so type errors surface only at run time unless you
ask for them: `npm run typecheck:backend` runs `tsc -p backend` (no emit). Relative
imports in `backend/` therefore carry the real `.ts` extension — Node resolves the
file on disk, so a `.js` specifier would not exist.

Open http://localhost:3000. In dev, Nuxt proxies `/api/v3` to the **remote
authentik** and `/app/api` to the backend, so the browser sees a single origin
(cookies just work). Password / enrollment / recovery flows work locally;
**social login can't complete in dev** (the cross-site authentik session cookie
won't stick over `http://localhost`) — test it against a same-host deployment.

## Configuration

All config is environment-driven — see [`.env.sample`](.env.sample). Key values:

| Variable | Purpose |
| --- | --- |
| `AUTHENTIK_URL` | Base URL of your authentik install |
| `AUTHENTIK_API_TOKEN` | Service-account token, used **only** for the migration flow |
| `AUTHENTIK_FLOW_*` | Slugs for the authentication / enrollment / recovery flows |
| `SESSION_SECRET` | Signs the session cookie |
| `LEGACY_API_URL` / `LEGACY_API_TOKEN` | Legacy Django system, for migration |

The `AUTHENTIK_FLOW_*` slugs default to ietf's custom flows
(`ietf-login`, etc.). Point them at your brand's configured
flows. Because the UI renders challenges dynamically, most flow changes you make
in authentik (adding an MFA stage, extra enrollment prompts, …) need **no
frontend changes** — unhandled stages render a labelled fallback in
[`FlowExecutor.vue`](frontend/components/FlowExecutor.vue) so you can add a
branch when you want a bespoke look.

## Legacy account migration

The custom, backend-only flow for users crossing over from the old Django system
(see [`backend/routes/migration.ts`](backend/routes/migration.ts)):

1. User submits their **old** credentials at `/migrate`.
2. Backend verifies them against the legacy system
   ([`verifyLegacyCredentials`](backend/lib/legacy.ts) — adapt this to your
   legacy transport: HTTP, direct DB, LDAP…).
3. On success, the backend creates the equivalent authentik user (via the admin
   token), carrying over the profile and a `migrated_from: django` attribute,
   and sets the password.
4. The user signs in normally.

## Production build & deploy

Frontend and backend are built and deployed **separately**, but served under one
origin (`account.ietf.org`) so the browser sees no CORS:

- **Frontend** — `npm run build:frontend` runs `nuxt generate` (SPA, base `/app/`)
  into `.output/public`. CI stages it under `dist/app/` and deploys it to a
  **Cloudflare Worker** ([`wrangler.toml`](wrangler.toml)) that serves the static
  assets at `/app/*` and redirects the bare root (see below).
- **Backend** — built as a container ([`docker/release.Dockerfile`](docker/release.Dockerfile))
  and deployed to Kubernetes ([`k8s/`](k8s/)). It runs the Fastify API at
  `/app/api` (`API_PREFIX=/app/api`); the edge forwards `/app/api/*` through
  unchanged. authentik keeps serving `/api/v3` at the domain root.

Both are wired together by [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

For a single-origin **local** production check, `npm run build` + `npm start` has
the backend serve the built SPA from `.output/public` itself (it degrades
gracefully when that directory is absent, which is the case in the container).

## Edge routing & redirects

In production `account.ietf.org` is fronted by Cloudflare. **authentik owns the
domain root** — `/`, `/api/v3`, `/if/*`, `/flows/*`, `/source/*`, `/static/*` —
and this app is mounted under **`/app/*`** (SPA on a Cloudflare Worker, see
[`wrangler.toml`](wrangler.toml)) with its backend at `/app/api`. Because this app
owns the entire public UX, three **Cloudflare Redirect Rules** keep users on the
custom front-end instead of ever seeing authentik's stock UI:

- Rule 1 handles cold landings on the bare root.
- Rule 2 handles authentik's fallback landing (e.g. after a social login that
  didn't carry a `next`).
- Rule 3 handles **third-party OAuth logins**: when another app sends the user to
  authentik to sign in, authentik would otherwise render its own login UI at
  `/if/flow/ietf-login/` (see "Third-party OAuth logins" below).
- Rule 4 handles **third-party OAuth logouts**: when an app logs the user out,
  authentik would otherwise render its stock session-end screen at
  `/if/flow/ietf-provider-invalidation-flow/` (see "Third-party OAuth logouts").

All live in the **Cloudflare dashboard** (Rules → Redirect Rules), not in this
repo — the Worker deliberately stays a plain assets-only deploy. They're
documented here so they aren't lost tribal knowledge.

| # | Redirect | When (host `account.ietf.org`) | Handles |
| --- | --- | --- | --- |
| 1 | root → `/app/` | `http.request.uri.path eq "/"` | Someone landing on the bare domain root |
| 2 | `/if/user*` → `/app/` | `starts_with(http.request.uri.path, "/if/user")` | authentik dropping the user on its own UI post-login / post-social when no `next` was carried |
| 3 | `/if/flow/ietf-login/` → `/app/login` (**preserving the querystring**) | `http.request.uri.path eq "/if/flow/ietf-login/"` | A third-party app's OAuth login landing on authentik's stock flow UI |
| 4 | `/if/flow/ietf-provider-invalidation/` → `/app/logout` (**preserving the querystring**) | `http.request.uri.path eq "/if/flow/ietf-provider-invalidation/"` | A third-party app's OAuth logout landing on authentik's stock session-end screen |
| 5 | `/if/flow/ietf-invalidation/` → `/app/signed-out` (**preserving the querystring**) | `http.request.uri.path eq "/if/flow/ietf-invalidation/"` | A sign-out landing on authentik's stock logout view |
| 6 | `/if/flow/ietf-social-callback/` → `/app/social-callback` (**preserving the querystring**) | `http.request.uri.path eq "/if/flow/ietf-social-callback/"` | An interactive social-login return landing on authentik's stock flow UI |
| 7 | `/if/flow/ietf-social-enrollment/` → `/app/social-enrollment` (**preserving the querystring**) | `http.request.uri.path eq "/if/flow/ietf-social-enrollment/"` | A first-time social sign-up landing on authentik's stock flow UI |
| 8 | `/if/flow/ietf-enrollment/` → `/app/verify-email` (**preserving the querystring**) | `http.request.uri.path eq "/if/flow/ietf-enrollment/"` | An enrollment email-confirmation link landing on authentik's stock flow UI |
| 9 | `/if/flow/ietf-recovery/` → `/app/reset-password` (**preserving the querystring**) | `http.request.uri.path eq "/if/flow/ietf-recovery/"` | A password-reset email link landing on authentik's stock flow UI |
| 10 | `/if/flow/ietf-provider-authorization/` → `/app/authorize` (**preserving the querystring**) | `http.request.uri.path eq "/if/flow/ietf-provider-authorization/"` | A third-party app's OAuth authorization (consent/redirect) landing on authentik's stock flow UI |

Rules 1 & 2 use a static **`302` → `https://account.ietf.org/app/`**. Rules 3–10
must **preserve the querystring** (rules 8 & 9 especially — they carry the email
token; rule 10 carries the OAuth request), so make them *dynamic* redirects — e.g.
`concat("https://account.ietf.org/app/login?", http.request.uri.query)` for rule 3
and the matching `/app/{logout,signed-out,social-callback,social-enrollment,verify-email,reset-password,authorize}?…`
targets for rules 4–10 (302).

**Rule 1 must match the root exactly** (`eq "/"`, not `starts_with`) — a prefix
match would swallow authentik's entire domain root (`/api/v3`, `/if/*`, `/flows/*`
…) and break everything.

**Rule 2 must stay a Cloudflare rule** rather than a Worker route: giving the
Worker an `/if/*` route would collide with authentik, which needs the rest of
`/if/*` — especially `/if/flow/*`, the flow-executor UI that social/OAuth returns
render in. So do **not** blanket-redirect `/if/flow/*`, `/source/*`, `/flows/*`,
`/api/*`, `/static/*`, or `/if/admin/*` (admins still need it).

**Rules 3–10 are the scoped exceptions** to that `/if/flow/*` warning: each matches
a single flow slug *exactly* (`/if/flow/ietf-login/`,
`/if/flow/ietf-provider-invalidation/`, `/if/flow/ietf-invalidation/`,
`/if/flow/ietf-social-callback/`, `/if/flow/ietf-social-enrollment/`,
`/if/flow/ietf-enrollment/`, `/if/flow/ietf-recovery/`,
`/if/flow/ietf-provider-authorization/`), so they leave every other
flow — MFA setup, admin flows — rendering in authentik. Keep them exact; a slug
that both a rule and another purpose share will route here for both, so give each
intercepted flow its own dedicated slug. (Rules 8 & 9 reuse the `ietf-enrollment`
and `ietf-recovery` slugs the registration and recover pages already drive, but
that's safe: the browser only *loads* `/if/flow/ietf-{enrollment,recovery}/` from
the email links — those pages drive the executor API directly and never hit that
path.)

### Third-party OAuth logins

authentik is also an **OAuth/OIDC provider**: other apps send users to it to sign
in. That path (`/application/o/authorize/?client_id=…`) builds a flow plan bound
to the OAuth request and 302s to authentik's stock flow UI. Rule 3 above
intercepts that and sends it to `/app/login`, where the SPA takes over **in resume
mode**:

- [`login.vue`](frontend/pages/login.vue) detects the provider flow by the
  `client_id` query param and passes `:resume` to
  [`FlowExecutor.vue`](frontend/components/FlowExecutor.vue).
- In resume mode [`useFlow.js`](frontend/composables/useFlow.js) **does not** cancel
  the plan (cancelling would drop the OAuth request — the app would never get its
  code) and forwards the original querystring to the executor.
- On completion the SPA follows authentik's terminal redirect (`xak-flow-redirect`
  → `to`) back to the app, instead of routing to its own home page.

Once the user is authenticated, authentik hands off to the OAuth provider's
**authorization flow** (`ietf-provider-authorization`) to grant access and issue
the app its code. For an already-signed-in user (SSO) the login flow above is
skipped entirely and this is the *only* flow that runs — so all the user sees is a
brief "redirecting" screen. Rule 10 intercepts its stock UI at
`/if/flow/ietf-provider-authorization/` and sends it to `/app/authorize`, where
[`authorize.vue`](frontend/pages/authorize.vue) drives it — again **in resume
mode** (cancelling would drop the OAuth request) and following the terminal
redirect back to the app on completion. Explicit-consent providers add an
`ak-stage-consent` stage, which [`FlowExecutor.vue`](frontend/components/FlowExecutor.vue)
renders. This path **can't be exercised in local dev** (authentik is remote), so
verify it against a same-host deployment with a real OAuth client.

### Third-party OAuth logouts

The mirror image of login. A provider can have an **invalidation flow** that runs
when an app logs the user out. We use **two** flows for this, and it's easy to mix
them up:

- **`ietf-provider-invalidation`** — set as the OAuth provider's *Invalidation
  flow*. When an app logs the user out, authentik builds a plan bound to that app
  and 302s to `/if/flow/ietf-provider-invalidation/…`. The flow ends on an
  **`ak-stage-session-end`** challenge (the "you've been signed out of *app*"
  screen with return / log-back-in / sign-out-entirely options) — *not* a terminal
  redirect. Rule 4 intercepts it to `/app/logout`, where
  [`logout.vue`](frontend/pages/logout.vue) drives the executor **in resume mode**
  (like the login path — cancelling would drop the app context) and
  [`FlowExecutor.vue`](frontend/components/FlowExecutor.vue) renders the stage. It
  must contain no `user_logout` stage, or the session ends before the screen shows.
- **`ietf-invalidation`** — the brand's *default invalidation flow*: the real
  logout (a `user_logout` stage). This is also driven in-app, by
  [`signed-out.vue`](frontend/pages/signed-out.vue): FlowExecutor GETs the executor,
  authentik ends the session, the flow completes immediately, and the page clears
  the local session record. All three sign-out entry points funnel through it: the
  account shell's "Sign out" ([`layouts/account.vue`](frontend/layouts/account.vue)),
  the session-end screen's "Sign out of IETF Account entirely" button, and — via
  **Rule 5** — any direct hit to `/if/flow/ietf-invalidation/`. (authentik still
  hands its URL back as `invalidation_flow_url` on the session-end challenge; the
  button ignores that in favour of the in-app page, which drives the same flow by
  config.) By default the page then shows a "you've been signed out" confirmation;
  the account shell passes `?redirect=login` to skip it and drop the user straight
  on the login screen, since signing out from inside the app is deliberate.

The provider-logout (session-end) path **can't be exercised in local dev** —
verify it against a same-host deployment with a real OAuth client performing an
RP-initiated logout. The plain sign-out (`/signed-out`) works in dev.

> The root redirect (rule 1) *could* instead be a `main` Worker script owning an
> exact `account.ietf.org/` route, which would version-control it in this repo.
> We keep all three redirects together in Cloudflare instead, so there's a single
> place to reason about edge routing and the Worker stays assets-only.
