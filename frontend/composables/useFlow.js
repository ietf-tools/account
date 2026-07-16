// Drives one authentik flow of a given `kind` ('authentication' | 'enrollment'
// | 'recovery') against the backend bridge. Returns reactive state plus
// `begin` / `submit` actions. The UI (FlowExecutor.vue) renders whatever
// challenge is current and calls `submit` with the stage's payload.
export function useFlow(kind) {
  const api = useApi()

  const challenge = ref(null)
  const complete = ref(false)
  const user = ref(null)
  const loading = ref(false)
  const error = ref(null)

  async function run(request) {
    loading.value = true
    error.value = null
    try {
      const res = await request
      challenge.value = res.challenge
      complete.value = res.complete
      user.value = res.user
      return res
    } catch (e) {
      error.value = e?.data?.error || e?.message || 'Something went wrong'
      throw e
    } finally {
      loading.value = false
    }
  }

  const begin = () => run(api(`/auth/flow/${kind}/begin`, { method: 'POST' }))
  const submit = (payload) =>
    run(api(`/auth/flow/${kind}/submit`, { method: 'POST', body: payload ?? {} }))

  return { challenge, complete, user, loading, error, begin, submit }
}
