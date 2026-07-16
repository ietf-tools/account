// Route guard for pages that require a signed-in user.
export default defineNuxtRouteMiddleware(async () => {
  const auth = useAuthStore()
  if (!auth.ready) {
    await auth.fetchSession()
  }
  if (!auth.isAuthenticated) {
    return navigateTo('/login')
  }
})
