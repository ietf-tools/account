// Drives useAppUpdate()'s polling: check for a newer build on route changes, when
// the tab regains focus (a user returning after a while), and on a slow interval.
// See composables/useAppUpdate.js and components/UpdateBanner.vue.
export default defineNuxtPlugin((nuxtApp) => {
  const { check } = useAppUpdate()
  const router = useRouter()

  const POLL_INTERVAL_MS = 5 * 60 * 1000

  router.afterEach(() => {
    check()
  })

  window.addEventListener('focus', () => {
    check()
  })

  const timer = window.setInterval(() => {
    check()
  }, POLL_INTERVAL_MS)

  nuxtApp.hook('app:beforeMount', () => {
    check()
  })

  // Nuxt reuses the client on hot-reload in dev; clear the timer if the app tears down.
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      window.clearInterval(timer)
    })
  }
})
