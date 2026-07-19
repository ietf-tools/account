# IETF Account

PRIVATE — a fully custom, headless front-end for [authentik](https://goauthentik.io).

authentik runs in the background as the identity source of truth; this app owns
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
  libs, not in authentik. See [`backend/routes/migration.js`](backend/routes/migration.js)
  and [`backend/lib/legacy.js`](backend/lib/legacy.js).

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

> This shared-host assumption is what makes the hand-off work. In local dev
> (frontend on `localhost:3000`, authentik remote) the cross-site session cookie
> won't stick, so exercise social login against a same-host deployment.

## Project layout

```
backend/                (only for features that need the admin token — not auth)
  index.js              Fastify bootstrap: CORS, cookies, session, static SPA, routes
  lib/
    config.js           Env-driven config (throws on missing SESSION_SECRET / AUTHENTIK_URL)
    authentik.js        Admin client (service-account token) — used only by migration
    legacy.js           Legacy Django client (migration only) — swap for your transport
  routes/
    migration.js        Legacy → authentik account migration (the only auth-ish route)
    health.js
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

Requires **Node.js 26+**. The included dev container provides it.

```bash
cp .env.sample .env      # then fill in AUTHENTIK_URL, SESSION_SECRET, etc.
npm install
```

Run the two processes in separate terminals:

```bash
npm run dev:backend      # Fastify on http://localhost:4000
npm run dev:frontend     # Nuxt on   http://localhost:3000
```

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

The `AUTHENTIK_FLOW_*` slugs default to authentik's built-ins
(`default-authentication-flow`, etc.). Point them at your brand's configured
flows. Because the UI renders challenges dynamically, most flow changes you make
in authentik (adding an MFA stage, extra enrollment prompts, …) need **no
frontend changes** — unhandled stages render a labelled fallback in
[`FlowExecutor.vue`](frontend/components/FlowExecutor.vue) so you can add a
branch when you want a bespoke look.

## Legacy account migration

The custom, backend-only flow for users crossing over from the old Django system
(see [`backend/routes/migration.js`](backend/routes/migration.js)):

1. User submits their **old** credentials at `/migrate`.
2. Backend verifies them against the legacy system
   ([`verifyLegacyCredentials`](backend/lib/legacy.js) — adapt this to your
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

All live in the **Cloudflare dashboard** (Rules → Redirect Rules), not in this
repo — the Worker deliberately stays a plain assets-only deploy. They're
documented here so they aren't lost tribal knowledge.

| # | Redirect | When (host `account.ietf.org`) | Handles |
| --- | --- | --- | --- |
| 1 | root → `/app/` | `http.request.uri.path eq "/"` | Someone landing on the bare domain root |
| 2 | `/if/user*` → `/app/` | `starts_with(http.request.uri.path, "/if/user")` | authentik dropping the user on its own UI post-login / post-social when no `next` was carried |
| 3 | `/if/flow/ietf-login/` → `/app/login` (**preserving the querystring**) | `http.request.uri.path eq "/if/flow/ietf-login/"` | A third-party app's OAuth login landing on authentik's stock flow UI |

Rules 1 & 2 use a static **`302` → `https://account.ietf.org/app/`**. Rule 3 must
**preserve the OAuth querystring**, so make it a *dynamic* redirect:
`concat("https://account.ietf.org/app/login?", http.request.uri.query)` (302).

**Rule 1 must match the root exactly** (`eq "/"`, not `starts_with`) — a prefix
match would swallow authentik's entire domain root (`/api/v3`, `/if/*`, `/flows/*`
…) and break everything.

**Rule 2 must stay a Cloudflare rule** rather than a Worker route: giving the
Worker an `/if/*` route would collide with authentik, which needs the rest of
`/if/*` — especially `/if/flow/*`, the flow-executor UI that social/OAuth returns
render in. So do **not** blanket-redirect `/if/flow/*`, `/source/*`, `/flows/*`,
`/api/*`, `/static/*`, or `/if/admin/*` (admins still need it).

**Rule 3 is the scoped exception** to that `/if/flow/*` warning: it matches the
authentication flow slug *exactly* (`/if/flow/ietf-login/`), so it leaves every
other flow — social-source returns, recovery-email links, MFA setup — rendering
in authentik. Keep it exact; if you point a social source at the *same*
`ietf-login` flow and it needs an interactive stage on return, it will also route
here (the SPA resumes it, which generally works, but is the one overlap to watch).

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

Explicit-consent providers add an `ak-stage-consent` stage, which FlowExecutor
renders. This path **can't be exercised in local dev** (authentik is remote), so
verify it against a same-host deployment with a real OAuth client.

> The root redirect (rule 1) *could* instead be a `main` Worker script owning an
> exact `account.ietf.org/` route, which would version-control it in this repo.
> We keep all three redirects together in Cloudflare instead, so there's a single
> place to reason about edge routing and the Worker stays assets-only.
