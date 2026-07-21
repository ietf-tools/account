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

  // End the authentik session by running its (brand default) invalidation flow
  // directly. Slug is configurable like the other flows (AUTHENTIK_FLOW_INVALIDATION).
  async function logout() {
    const ak = useAuthentik()
    const slug = useRuntimeConfig().public.flows.invalidation
    await ak(`/flows/executor/${slug}/?query=`).catch(() => {})
    user.value = null
  }

  return { user, ready, isAuthenticated, fetchSession, setUser, logout }
})
