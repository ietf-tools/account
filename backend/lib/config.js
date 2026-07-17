import 'dotenv/config'

function required(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

// Normalise a URL path prefix to a single leading slash and no trailing slash
// ("/app/api/" -> "/app/api", "api" -> "/api"). An empty/"/" value yields "",
// i.e. routes mount at the root.
function normalisePrefix(value) {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '')
  return trimmed ? `/${trimmed}` : ''
}

export const config = {
  port: Number(process.env.BACKEND_PORT ?? 4000),
  isProd: process.env.NODE_ENV === 'production',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',

  // Path the API is served under. authentik owns the domain root (incl. its own
  // /api) on account.ietf.org and the app is mounted at /app, so in production
  // the backend serves at /app/api and the edge forwards without stripping the
  // prefix. Default "/api" keeps local dev (and the Nuxt dev proxy) unchanged.
  apiPrefix: normalisePrefix(process.env.API_PREFIX ?? '/api'),

  session: {
    secret: required('SESSION_SECRET'),
    secure: process.env.SESSION_SECURE === 'true',
    // 7 days
    maxAge: 1000 * 60 * 60 * 24 * 7
  },

  authentik: {
    // Normalise: strip any trailing slash so we can join paths safely.
    url: required('AUTHENTIK_URL').replace(/\/+$/, ''),
    apiToken: process.env.AUTHENTIK_API_TOKEN ?? '',
    flows: {
      authentication: process.env.AUTHENTIK_FLOW_AUTHENTICATION ?? 'default-authentication-flow',
      enrollment: process.env.AUTHENTIK_FLOW_ENROLLMENT ?? 'default-enrollment-flow',
      recovery: process.env.AUTHENTIK_FLOW_RECOVERY ?? 'default-recovery-flow'
    }
  },

  legacy: {
    apiUrl: process.env.LEGACY_API_URL ?? '',
    apiToken: process.env.LEGACY_API_TOKEN ?? ''
  }
}
