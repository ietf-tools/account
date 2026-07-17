# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Production image for the Fastify BFF only.
#
# The Nuxt SPA is deployed separately to Cloudflare Pages, so this image never
# builds or serves the frontend — it installs production dependencies (Fastify +
# plugins, no Nuxt/Tailwind toolchain) and runs backend/index.js. The backend
# degrades gracefully when the SPA dir is absent (see backend/index.js).
#
# Everything is served under one origin (account.ietf.org): authentik owns the
# root (including its own /api/v3), the SPA is at /app, and this backend is
# proxied at /app/api — NOT root /api, which would collide with authentik's API.
# The backend serves that full path itself (API_PREFIX=/app/api below), so the
# edge just forwards /app/api/* through UNCHANGED — no prefix stripping. Set
# API_PREFIX to match wherever the app is mounted. Same-origin means no
# cross-origin CORS config is needed in production — FRONTEND_URL only matters
# for local dev.
# ─────────────────────────────────────────────────────────────────────────────

# ── deps: install production node_modules against a reproducible lockfile ─────
FROM node:26-slim AS deps

WORKDIR /app

# Copy only the manifest + lockfile so this layer is cached until deps change.
COPY package.json package-lock.json ./

# --omit=dev skips the Nuxt/Tailwind/oxlint devDependencies entirely; only the
# Fastify runtime deps are needed to run the backend. --ignore-scripts avoids
# running the repo's install hooks (none are needed to run the server).
RUN npm ci --omit=dev --ignore-scripts


# ── runtime: minimal image that just runs the server ─────────────────────────
FROM node:26-slim AS runtime

ENV NODE_ENV=production \
    BACKEND_PORT=4000 \
    API_PREFIX=/app/api

WORKDIR /app

# Bring in the pruned production dependencies and application source.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY backend ./backend

# Drop privileges: the node images ship an unprivileged `node` user.
USER node

EXPOSE 4000

# Lightweight liveness probe against the backend's health route (respects the
# configured API_PREFIX so it keeps working if the mount path changes).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.BACKEND_PORT||4000)+(process.env.API_PREFIX||'/api')+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/index.js"]
