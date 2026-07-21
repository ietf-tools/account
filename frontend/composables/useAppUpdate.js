// Detects when a newer build has been deployed while this tab stayed open, so we
// can offer a reload instead of letting stale code call endpoints that may have
// changed. The running bundle bakes in its own buildId (runtimeConfig.public,
// set in nuxt.config.ts); we compare it against /version.json, which the backend
// serves no-cache (see backend/index.js). Complements chunk-reload.client.js:
// that handles hard chunk failures, this handles the graceful "please reload".
export function useAppUpdate() {
  const updateAvailable = useState('appUpdateAvailable', () => false)
  const config = useRuntimeConfig()
  const currentBuild = config.public.buildId

  async function check() {
    // Once we know an update is out, stop polling — the banner is already up.
    if (updateAvailable.value || !currentBuild) {
      return
    }
    try {
      const base = config.app.baseURL.endsWith('/') ? config.app.baseURL : `${config.app.baseURL}/`
      const data = await $fetch(`${base}version.json`, {
        // Belt and suspenders alongside the server's no-cache header.
        cache: 'no-store',
        query: { _: Date.now() }
      })
      if (data?.buildId && data.buildId !== currentBuild) {
        updateAvailable.value = true
      }
    } catch {
      // Missing (dev) or a transient network error — ignore and try again next tick.
    }
  }

  function reload() {
    window.location.reload()
  }

  return { updateAvailable, check, reload }
}
