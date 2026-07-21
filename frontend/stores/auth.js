import { defineStore } from 'pinia'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const ready = ref(false)
  const isAuthenticated = computed(() => Boolean(user.value))

  // Identity is whatever authentik says: resolve the current user straight from
  // authentik (same-origin in prod), no app-side session involved.
  async function fetchSession() {
    const ak = useAuthentik()
    try {
      const body = await ak('/core/users/me/')
      const current = body.user ?? body
      user.value = isAnonymous(current) ? null : toSessionUser(current)
    } catch {
      user.value = null
    } finally {
      ready.value = true
    }
  }

  function setUser(value) {
    user.value = value
    ready.value = true
  }

  // Signing out is driven in the UI by the /signed-out page (it runs authentik's
  // `invalidation` flow through FlowExecutor and calls setUser(null) on
  // completion), so there's no logout() here — the store just tracks state.

  return { user, ready, isAuthenticated, fetchSession, setUser }
})
