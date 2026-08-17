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

// Split a comma/whitespace separated domain list into bare lower-cased hostnames,
// tolerating the "@ietf.org" and "ietf.org." spellings people naturally write.
// Kept byte-for-byte in step with the same parse in nuxt.config.ts, which reads
// the same env var (see blockedEmailDomains below).
function parseDomainList(value) {
  return value
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase().replace(/^@+/, '').replace(/\.+$/, ''))
    .filter(Boolean)
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

  // Email domains that may not be attached to an account: sign-up, social sign-up,
  // recovery addresses and the verified email change all refuse them (see
  // lib/email-domains.js for the matching rule). @ietf.org is blocked because those
  // addresses are institutional aliases, not mailboxes a person keeps — an account
  // reachable only through one is unrecoverable the moment its owner moves on.
  //
  // nuxt.config.ts reads this SAME env var, so one setting drives the backend gate
  // and the SPA's inline check. Registration is neither one's gate — the browser
  // drives the enrollment flow straight against authentik, so that gate is a policy
  // over there, holding its own copy of the list (see
  // authentik/ietf-flows/ietf-blocked-email-domains.yaml — keep the three in sync).
  blockedEmailDomains: parseDomainList(process.env.BLOCKED_EMAIL_DOMAINS ?? 'ietf.org'),

  session: {
    secret: required('SESSION_SECRET'),
    secure: process.env.SESSION_SECURE === 'true',
    // 7 days
    maxAge: 1000 * 60 * 60 * 24 * 7
  },

  authentik: {
    // Normalise: strip any trailing slash so we can join paths safely.
    url: required('AUTHENTIK_URL').replace(/\/+$/, ''),
    // Service-account token — used by backend features (legacy migration,
    // verified email change). Flow slugs live in the frontend (the SPA drives
    // flows directly).
    apiToken: process.env.AUTHENTIK_API_TOKEN ?? ''
  },

  // GitHub REST API, used only to resolve a linked GitHub account's numeric id to
  // its username (Connected Services → refresh; see routes/github.js). Optional:
  // without a token the lookup still works but is rate limited to 60/hour for the
  // whole server. Any classic PAT with no scopes lifts that to 5000/hour.
  github: {
    apiToken: process.env.GITHUB_API_TOKEN ?? ''
  },

  // Absolute base URL of the SPA, used to build links in emails the backend
  // sends (currently the email-change confirmation). In production the app is
  // mounted under /app on account.ietf.org, so this includes the /app prefix.
  // Defaults to the dev frontend + /app.
  publicAppUrl: (
    process.env.PUBLIC_APP_URL ?? `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/app`
  ).replace(/\/+$/, ''),

  // SMTP, for backend-sent transactional email (the email-change verification).
  // Optional: the email-change feature throws a clear error if unconfigured.
  // Point it at the same SMTP server authentik uses.
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    // true for implicit TLS (port 465); false uses STARTTLS (port 587).
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASSWORD ?? '',
    from: process.env.SMTP_FROM ?? 'IETF Account <noreply@ietf.org>'
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
    // Object key prefix. Defaults to none, so files sit at the bucket root
    // (the bucket is already served from a dedicated host, e.g. avatars.…).
    keyPrefix: (process.env.AVATAR_S3_KEY_PREFIX ?? '').replace(/^\/+/, ''),
    // MinIO and most non-AWS S3s need path-style addressing (bucket in the path,
    // not the host). Defaults on when a custom endpoint is set.
    forcePathStyle: process.env.AVATAR_S3_FORCE_PATH_STYLE
      ? process.env.AVATAR_S3_FORCE_PATH_STYLE === 'true'
      : Boolean(process.env.AVATAR_S3_ENDPOINT)
  }
}
