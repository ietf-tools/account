import { fileURLToPath } from 'node:url'
import { statSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'

import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import session from '@fastify/session'
import sensible from '@fastify/sensible'
import fastifyStatic from '@fastify/static'

import { config } from './lib/config.ts'
import migrationRoutes from './routes/migration.ts'
import avatarRoutes from './routes/avatar.ts'
import portraitRoutes from './routes/portrait.ts'
import passwordlessRoutes from './routes/passwordless.ts'
import emailChangeRoutes from './routes/email-change.ts'
import githubRoutes from './routes/github.ts'
import datatrackerRoutes from './routes/datatracker.ts'
import recoveryEmailsRoutes from './routes/recovery-emails.ts'
import accountRecoveryRoutes from './routes/account-recovery.ts'
import healthRoutes from './routes/health.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = Fastify({
  trustProxy: config.isProd,
  logger: config.isProd
    ? true
    : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
})

await app.register(sensible)

await app.register(cors, {
  origin: config.frontendUrl,
  credentials: true
})

await app.register(cookie)

// In-memory session store: authentik owns auth (the browser drives its flows
// directly), so the only server-side state is the legacy migration's two-step
// handoff — see routes/migration.ts. For a multi-instance deployment, put a
// shared store (Redis) here instead — no schema/migrations required either way.
await app.register(session, {
  secret: config.session.secret,
  cookie: {
    secure: config.session.secure,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: config.session.maxAge
  },
  saveUninitialized: false
})

// All API routes live under config.apiPrefix (default "/api", "/app/api" in the
// account.ietf.org production deployment — see lib/config.ts). Auth flows are NOT
// here: the SPA talks to authentik directly. This backend is migration-only.
await app.register(healthRoutes, { prefix: config.apiPrefix })
await app.register(migrationRoutes, { prefix: `${config.apiPrefix}/migration` })
await app.register(avatarRoutes, { prefix: `${config.apiPrefix}/avatar` })
await app.register(portraitRoutes, { prefix: `${config.apiPrefix}/portrait` })
await app.register(passwordlessRoutes, { prefix: `${config.apiPrefix}/passwordless` })
await app.register(emailChangeRoutes, { prefix: `${config.apiPrefix}/email-change` })
await app.register(githubRoutes, { prefix: `${config.apiPrefix}/github` })
await app.register(datatrackerRoutes, { prefix: `${config.apiPrefix}/datatracker` })
await app.register(recoveryEmailsRoutes, { prefix: `${config.apiPrefix}/recovery-emails` })
// Unauthenticated by design — the signed link is the authorisation. See the route.
await app.register(accountRecoveryRoutes, { prefix: `${config.apiPrefix}/account-recovery` })

// In production the built SPA (nuxt generate -> .output/public) *may* be served by
// this same server, so the browser only ever talks to one origin. It is optional:
// the account.ietf.org deployment ships the SPA to Cloudflare Pages instead and
// builds a backend-only image (docker/release.Dockerfile copies just backend/), so
// this directory legitimately does not exist there.
//
// Decide that up front rather than by registering and catching a failure —
// @fastify/static does NOT reject a missing root, it logs its own
// `"root" path "…" must exist` warning and registers anyway, which left the SPA
// fallback below installed but unable to send anything.
const spaDir = join(__dirname, '..', '.output', 'public')
const hasSpa = statSync(spaDir, { throwIfNoEntry: false })?.isDirectory() ?? false

if (hasSpa) {
  await app.register(fastifyStatic, {
    root: spaDir,
    wildcard: false,
    // We set Cache-Control ourselves per file (below); let @fastify/static keep
    // managing ETag/Last-Modified so no-cache responses still revalidate cheaply
    // with 304s.
    cacheControl: false,
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${sep}_nuxt${sep}`)) {
        // Fingerprinted bundles: the filename changes when the content does, so
        // they're safe to cache forever. This is what lets an already-open tab
        // keep loading the chunks it booted with after a new deploy lands.
        res.setHeader('cache-control', 'public, max-age=31536000, immutable')
      } else if (filePath.endsWith('index.html') || filePath.endsWith(`${sep}version.json`)) {
        // The entry document and the version marker must never be served stale,
        // or a browser/edge keeps pointing at an old build. Revalidate every time.
        res.setHeader('cache-control', 'no-cache')
      } else {
        // Other, un-fingerprinted root assets (rare): a short TTL, still fresh soon.
        res.setHeader('cache-control', 'public, max-age=3600')
      }
    }
  })
} else {
  app.log.info(`No SPA build at ${spaDir}; serving the API only.`)
}

// SPA fallback: anything not matched above returns index.html. sendFile goes
// through the same static instance, so index.html gets the no-cache header too.
// Without a build to fall back to there is nothing to send, so every unmatched
// route answers like an API one.
app.setNotFoundHandler((request, reply) => {
  if (!hasSpa || request.url.startsWith(config.apiPrefix || '/api')) {
    reply.code(404).send({ error: 'Not found' })
  } else {
    reply.sendFile('index.html')
  }
})

try {
  await app.listen({ port: config.port, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
