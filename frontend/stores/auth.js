import { defineStore } from 'pinia'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const ready = ref(false)
  const isAuthenticated = computed(() => Boolean(user.value))

  async function fetchSession() {
    const api = useApi()
    try {
      const { user: current } = await api('/auth/session')
      user.value = current
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

  async function logout() {
    const api = useApi()
    await api('/auth/logout', { method: 'POST' }).catch(() => {})
    user.value = null
  }

  return { user, ready, isAuthenticated, fetchSession, setUser, logout }
})
