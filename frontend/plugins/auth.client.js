// Resolve the current session once, before the app renders, so route
// middleware and the layout know whether a user is signed in.
export default defineNuxtPlugin(async () => {
  const auth = useAuthStore()
  if (!auth.ready) {
    await auth.fetchSession()
  }
})
