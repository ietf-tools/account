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
    // Service-account token — used only by backend features (legacy migration).
    // Flow slugs live in the frontend now (the SPA drives flows directly).
    apiToken: process.env.AUTHENTIK_API_TOKEN ?? ''
  },

  legacy: {
    apiUrl: process.env.LEGACY_API_URL ?? '',
    apiToken: process.env.LEGACY_API_TOKEN ?? ''
  },

  // S3-compatible object storage for uploaded avatars. Optional: only the avatar
  // upload feature needs it (it throws a clear error if a user uploads while
  // unconfigured). Storing the image as an object and putting its URL — not the
  // bytes — in authentik keeps the OIDC `picture` claim small and cacheable for
  // other apps. `endpoint` is for S3-compatibles like MinIO (leave blank for AWS
  // S3). `publicUrl` is the base other apps fetch the image from (the bucket's
  // public URL or a CDN in front of it); we append the object key to it.
  storage: {
    endpoint: process.env.AVATAR_S3_ENDPOINT ?? '',
    region: process.env.AVATAR_S3_REGION ?? 'us-east-1',
    bucket: process.env.AVATAR_S3_BUCKET ?? '',
    accessKeyId: process.env.AVATAR_S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.AVATAR_S3_SECRET_ACCESS_KEY ?? '',
    publicUrl: (process.env.AVATAR_S3_PUBLIC_URL ?? '').replace(/\/+$/, ''),
    keyPrefix: (process.env.AVATAR_S3_KEY_PREFIX ?? 'avatars/').replace(/^\/+/, ''),
    // MinIO and most non-AWS S3s need path-style addressing (bucket in the path,
    // not the host). Defaults on when a custom endpoint is set.
    forcePathStyle: process.env.AVATAR_S3_FORCE_PATH_STYLE
      ? process.env.AVATAR_S3_FORCE_PATH_STYLE === 'true'
      : Boolean(process.env.AVATAR_S3_ENDPOINT)
  }
}
