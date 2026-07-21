// After a deploy, a tab still running the old entry document may try to load a
// dynamic chunk (a lazy route/component) whose fingerprinted file no longer
// exists on the server — Nuxt fires `app:chunkError`. Rather than dead-ending,
// reload once onto the fresh build. The sessionStorage guard stops a reload loop
// if the failure somehow persists (e.g. the new build is genuinely broken).
export default defineNuxtPlugin((nuxtApp) => {
  const RELOAD_KEY = 'chunk-reload-at'
  const RELOAD_COOLDOWN_MS = 10_000

  function reloadOnce() {
    const last = Number(window.sessionStorage.getItem(RELOAD_KEY) || 0)
    if (Date.now() - last < RELOAD_COOLDOWN_MS) {
      return
    }
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
    window.location.reload()
  }

  nuxtApp.hook('app:chunkError', () => {
    reloadOnce()
  })

  // Vite emits this for failed preloads that don't surface through the router.
  window.addEventListener('vite:preloadError', () => {
    reloadOnce()
  })
})
