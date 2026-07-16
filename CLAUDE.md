# CLAUDE.md

Brief for working in this repo. See [README.md](README.md) for the fuller narrative.

## What this is

A **headless, fully-custom front-end for [authentik](https://goauthentik.io)** — the public-facing
IETF Account UI (sign in, register, password reset, legacy migration). authentik is the identity
source of truth and runs separately; this app owns the entire UX by driving authentik's **Flow
Executor API** from a backend-for-frontend (BFF). There is **no admin surface** and **no database**.

```
Browser ──► Nuxt SPA (frontend/) ──► Fastify BFF (backend/) ──► authentik API
                                          └──► legacy Django system (migration only)
```

## Stack & layout

- **Frontend:** Nuxt 4 SPA (`ssr: false`), Pinia, Tailwind. Source in `frontend/` (`srcDir`).
- **Backend:** Fastify (ESM, Node 26+), in-memory session. Source in `backend/`.
- Config: [nuxt.config.ts](nuxt.config.ts), [backend/lib/config.js](backend/lib/config.js) (env-driven).

```
backend/
  index.js            Fastify bootstrap: CORS, cookie, session, static SPA, route registration
  lib/authentik.js    Headless client: Flow Executor + admin API + cookie-jar helpers
  lib/config.js       Env config (throws on missing SESSION_SECRET / AUTHENTIK_URL)
  lib/legacy.js       Legacy Django client (migration only)
  routes/auth.js      Flow bridge (begin/submit), /session, /logout, /social/finalize
  routes/migration.js Legacy → authentik account migration
frontend/
  components/FlowExecutor.vue  Dynamic authentik challenge renderer (the core UI)
  composables/useFlow.js       Drives one flow via the backend; useApi.js = $fetch w/ credentials
  stores/auth.js               Pinia session store
  pages/                       login, register, recover, migrate, index (protected)
  layouts/default.vue          Centered card, IETF logo + glows, no header bar
  middleware/auth.js           Route guard; plugins/auth.client.js resolves session on boot
```

## Core model: the Flow Executor bridge

authentik has no traditional "login API". Every flow (authentication/enrollment/recovery) is a state
machine of **challenges** (JSON keyed by `component`, e.g. `ak-stage-identification`,
`ak-stage-password`). The BFF `begin`s a flow and relays each `challenge` to the SPA;
[FlowExecutor.vue](frontend/components/FlowExecutor.vue) renders it, collects input, and `submit`s.
The flow's cookie jar is held **server-side** in the Fastify session and replayed on each call.
Completion = the terminal `xak-flow-redirect`; the backend then resolves the user via
`/core/users/me/` and stores a trimmed record in the session.

**Adding UI for a new stage:** add a branch in FlowExecutor's template keyed on `component`.
Unhandled stages render a labelled fallback (never a dead end), so the app degrades gracefully.

## Gotchas (read before changing auth)

- **Invariant: the browser never talks to authentik directly — EXCEPT social login.** OAuth requires
  a real browser redirect, so social login is the one exception (see below). Don't "fix" that
  asymmetry by routing password flows through the browser.
- **Social / source logins** ([routes/auth.js](backend/routes/auth.js) `/social/finalize`,
  FlowExecutor `continueWithSource`): buttons come from `challenge.sources` on the identification
  stage (backend rewrites them to absolute `url`/`icon_url`). Clicking does a full-page redirect to
  authentik with `?next=…/login?social=return`. On return, login.vue calls `POST /auth/social/finalize`,
  which **rebuilds authentik's cookie jar from the incoming request cookies** (`authentik_*`) and
  resolves the user. **This only works because the app is deployed on the same host as authentik**
  (`account.ietf.org`) so authentik's session cookie reaches the BFF. It **cannot complete in local
  dev** (frontend on `localhost`, authentik remote).
- **Deployment mount:** app runs under **`/app/`** on `account.ietf.org`; authentik owns the domain
  root (including `/api`). Hence `app.baseURL='/app/'` and the app's own API is at **`/app/api`**
  (not `/api`, to avoid colliding with authentik). The reverse proxy must route `/app/*` to this
  app's backend and **strip the `/app` prefix** (backend still serves `/api` + static at root).
  Overridable via `NUXT_APP_BASE_URL` / `NUXT_PUBLIC_API_URL`.
- **`autofocus` does not fire** on SPA navigation or Vue stage swaps. Focus programmatically instead —
  FlowExecutor focuses the first field on every `challenge` change (`focusFirstField` + `formEl` ref);
  migrate.vue focuses on mount via a ref. Follow this pattern for new focusable steps.
- **Client-side validation** lives in FlowExecutor (`validateIdentification`): empty/invalid email is
  blocked before submit and shown inline; server-side field errors come from `response_errors`.
- **Sessions are in-memory** — a restart logs everyone out; multi-instance needs a shared store
  (swap in [backend/index.js](backend/index.js)). Backend session cookie is `sessionId`.
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
