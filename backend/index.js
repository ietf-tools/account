import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import session from '@fastify/session'
import sensible from '@fastify/sensible'
import fastifyStatic from '@fastify/static'

import { config } from './lib/config.js'
import authRoutes from './routes/auth.js'
import migrationRoutes from './routes/migration.js'
import healthRoutes from './routes/health.js'

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

// In-memory session store: authentik is the source of truth, so the session
// only needs to hold the in-flight flow cookie jar + the resolved user for the
// life of a browser session. For a multi-instance deployment, put a shared
// store (Redis) here instead — no schema/migrations required either way.
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

// Guard for routes that require an authenticated authentik session.
app.decorate('authenticate', async (request, reply) => {
  if (!request.session.user) {
    reply.code(401).send({ error: 'Not authenticated' })
  }
})

await app.register(healthRoutes, { prefix: '/api' })
await app.register(authRoutes, { prefix: '/api/auth' })
await app.register(migrationRoutes, { prefix: '/api/migration' })

// In production the built SPA (nuxt generate -> .output/public) is served by
// this same server, so the browser only ever talks to one origin.
const spaDir = join(__dirname, '..', '.output', 'public')
await app
  .register(fastifyStatic, { root: spaDir, wildcard: false })
  .then(() => {
    // SPA fallback: anything not matched above returns index.html.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api')) {
        reply.code(404).send({ error: 'Not found' })
      } else {
        reply.sendFile('index.html')
      }
    })
  })
  .catch((err) => {
    app.log.warn(`Static SPA dir not available (${spaDir}); run "npm run build" for production. ${err.message}`)
  })

try {
  await app.listen({ port: config.port, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
