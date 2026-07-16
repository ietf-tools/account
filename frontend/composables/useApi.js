// A configured $fetch pointed at the backend, always sending the session cookie.
// In dev, `apiUrl` is `/api` which Nuxt proxies to the Fastify backend on :4000.
// In prod it is `/api` served by the backend itself (same origin).
export function useApi() {
  const config = useRuntimeConfig()
  return $fetch.create({
    baseURL: config.public.apiUrl,
    credentials: 'include'
  })
}
