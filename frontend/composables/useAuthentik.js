// Direct browser client for authentik's public API.
//
// In production the SPA (served from /app/) and authentik (/api/v3) live on the
// same host — account.ietf.org — so these calls are same-origin: no CORS, and
// authentik's own cookies (authentik_csrf, the flow jar, the session) are set on
// and replayed by the browser automatically. This is exactly how authentik's own
// web UI drives flows, and it means authentik sees the real client IP / origin
// instead of the backend's. In dev the Nuxt proxy forwards /api/v3 -> the remote
// authentik so the browser still only talks to one origin.
//
// The backend is NOT in this path — it exists only for custom features that need
// the admin API token (the legacy migration). See useApi() for that.
function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : ''
}

export function useAuthentik() {
  const config = useRuntimeConfig()
  return $fetch.create({
    baseURL: config.public.authentikApiUrl,
    credentials: 'include',
    headers: { Accept: 'application/json' },
    onRequest({ options }) {
      // authentik/Django CSRF: on unsafe methods, echo the cookie authentik set
      // back as the X-authentik-CSRF header. (Origin/Referer are set by the
      // browser and, being same-origin in prod, pass Django's checks.)
      const method = (options.method ?? 'GET').toUpperCase()
      if (method === 'GET' || method === 'HEAD') {
        return
      }
      const csrf = readCookie('authentik_csrf')
      if (!csrf) {
        return
      }
      const headers = new Headers(options.headers)
      headers.set('X-authentik-CSRF', csrf)
      options.headers = headers
    }
  })
}
