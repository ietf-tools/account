import 'dotenv/config'

function required(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export const config = {
  port: Number(process.env.BACKEND_PORT ?? 4000),
  isProd: process.env.NODE_ENV === 'production',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',

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
