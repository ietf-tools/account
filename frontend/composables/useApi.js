// A configured $fetch pointed at the app's own backend, always sending the
// session cookie. Used only for custom features that aren't authentik flows
// (currently the legacy migration) — auth talks to authentik via useAuthentik().
// `apiUrl` is `…/app/api`, proxied to the Fastify backend in dev and served by it
// same-origin in prod.
export function useApi() {
  const config = useRuntimeConfig()
  return $fetch.create({
    baseURL: config.public.apiUrl,
    credentials: 'include'
  })
}
