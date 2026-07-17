# IETF Account

PRIVATE — a fully custom, headless front-end for [authentik](https://goauthentik.io).

authentik runs in the background as the identity source of truth; this app owns
the entire public-facing user experience (sign in, register, password reset,
legacy account migration) by driving authentik's **Flow Executor API** from a
backend-for-frontend. There is no admin surface here — admins use the authentik
admin interface directly.

## Architecture

```
Browser ──► Nuxt SPA (frontend/) ──► Fastify BFF (backend/) ──► authentik API
                                          │
                                          └──► legacy Django system (migration only)
```

- **No database.** authentik holds all identity state. The backend keeps only an
  in-memory session (the in-flight flow cookie jar + the resolved user). For a
  multi-instance deployment, swap the in-memory session store in
  [`backend/index.js`](backend/index.js) for a shared store (e.g. Redis).
- **Headless auth.** The frontend never talks to authentik. It asks the backend
  to `begin` a flow, renders whatever *challenge* comes back, and `submit`s the
  user's input. The backend replays authentik's flow cookies so its state
  machine advances, and captures the user once the flow completes. See
  [`backend/lib/authentik.js`](backend/lib/authentik.js) and
  [`backend/routes/auth.js`](backend/routes/auth.js).
- **Custom backend logic** (e.g. legacy migration) lives in dedicated routes and
  libs, not in authentik. See [`backend/routes/migration.js`](backend/routes/migration.js)
  and [`backend/lib/legacy.js`](backend/lib/legacy.js).

### How a login works

1. Frontend `POST /api/auth/flow/authentication/begin` → backend calls authentik's
   Flow Executor, returns the first challenge (`ak-stage-identification`).
2. [`FlowExecutor.vue`](frontend/components/FlowExecutor.vue) renders the stage.
   User submits → `POST /api/auth/flow/authentication/submit`.
3. Repeat for each stage (password, MFA, prompts…) until authentik returns the
   terminal `xak-flow-redirect`. The backend then resolves the user via
   `/core/users/me/` and stores them in the session.

The same three-verb bridge drives **enrollment** (register) and **recovery**
(password reset) — only the flow slug differs.

### Social / source logins

authentik's configured login **sources** (OAuth/SAML — e.g. Apple, GitHub,
Google) ride along on the `ak-stage-identification` challenge, so the login page
renders them as a row of buttons under the email field with **no per-provider
config here** — enable them in authentik and they appear.

OAuth can't be driven headlessly like a password stage: the browser has to leave
this app for authentik (and on to the provider) and come back. So the buttons do
a full-page redirect to the source's login URL with a `next` that returns to
`/login?social=return`. authentik authenticates the user and — because this app
is deployed on the **same host** as authentik (`account.ietf.org`, app under
`/app`) — sets its session cookie where our backend can see it. On return the SPA
calls `POST /api/auth/social/finalize`, which rebuilds authentik's cookie jar
from the request and resolves the user, completing sign-in just like a flow.

> This shared-host assumption is what makes the hand-off work. In local dev
> (frontend on `localhost:3000`, authentik remote) the round-trip can't
> complete, so exercise social login against a same-host deployment.

## Project layout

```
backend/
  index.js              Fastify bootstrap: CORS, cookies, session, static SPA, routes
  lib/
    config.js           Env-driven config
    authentik.js        Headless client: Flow Executor + admin API (+ cookie jar)
    legacy.js           Legacy Django client (migration only) — swap for your transport
  routes/
    auth.js             begin/submit flow bridge, /session, /logout
    migration.js        Legacy → authentik account migration
    health.js
frontend/
  app.vue, layouts/, pages/     login, register, recover, migrate, index (protected)
  components/FlowExecutor.vue    Dynamic authentik challenge renderer
  composables/          useApi, useFlow
  stores/auth.js        Pinia session store
  middleware/auth.js    Route guard
  plugins/auth.client.js  Resolves session on boot
nuxt.config.ts          SPA config; dev-proxies /api → backend :4000
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

Open http://localhost:3000. In dev, the frontend proxies `/api` to the backend,
so the browser sees a single origin (cookies just work).

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

## Production build

```bash
npm run build            # nuxt generate → .output/public
npm start                # Fastify serves the API *and* the built SPA (same origin)
```

In production the backend serves the SPA from `.output/public` with an
API-aware fallback, so there is no separate frontend server and no CORS.
