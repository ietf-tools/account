// Drives one authentik flow of a given `kind` ('authentication' | 'enrollment' |
// 'recovery') by talking to authentik's Flow Executor **directly** from the
// browser (see useAuthentik). Returns reactive state plus `begin` / `submit`
// actions. FlowExecutor.vue renders whatever challenge is current and calls
// `submit` with the stage's payload.
//
// authentik has no traditional "login API": each flow is a state machine of
// challenges (JSON keyed by `component`). We GET the executor to begin, POST to
// advance, and the flow's cookies live in the browser (not a server-side jar).
// The terminal `xak-flow-redirect` component means authentication succeeded, at
// which point we resolve the user via /core/users/me/.
export function useFlow(kind) {
  const ak = useAuthentik()
  const runtime = useRuntimeConfig()
  const slug = runtime.public.flows[kind]

  const challenge = ref(null)
  const complete = ref(false)
  const user = ref(null)
  const loading = ref(false)
  const error = ref(null)

  // The executor URL. `query` mirrors the flow page's querystring; empty is what
  // a fresh, headless start uses.
  const executorUrl = `/flows/executor/${slug}/?query=`
  const cancelUrl = flowsCancelUrl(runtime.public.authentikApiUrl)

  // Discard any existing server-side flow plan so the next executor GET re-plans
  // from stage one. authentik keeps the plan in its session (keyed by the browser
  // cookie), so — unlike the old throwaway server-side jar — a bare `begin` would
  // otherwise resume mid-flow (e.g. the password step after "Not you?"). There's
  // no executor query-param for this; CancelView clears the plan then redirects,
  // and we only need the side effect, so the redirect itself is ignored.
  async function reset() {
    await fetch(cancelUrl, {
      method: 'GET',
      credentials: 'include',
      redirect: 'manual'
    }).catch(() => {})
  }

  async function resolveUser() {
    // Flow reached xak-flow-redirect => the browser is now authenticated in
    // authentik. Resolve who just signed in / enrolled.
    const body = await ak('/core/users/me/')
    return toSessionUser(body.user ?? body)
  }

  async function apply(next) {
    challenge.value = withSources(next)
    complete.value = isFlowComplete(next)
    if (complete.value) {
      user.value = await resolveUser()
    }
    return { challenge: challenge.value, complete: complete.value, user: user.value }
  }

  async function run(request) {
    loading.value = true
    error.value = null
    try {
      return await apply(await request)
    } catch (e) {
      error.value = e?.data?.detail || e?.data?.error || e?.message || 'Something went wrong'
      throw e
    } finally {
      loading.value = false
    }
  }

  // Always start a flow fresh (matches the old server-side "new jar per begin"
  // semantics): reset the plan, then fetch the first challenge. This is what the
  // "Not you?" link calls to return to the identification stage.
  const begin = () =>
    run(
      (async () => {
        await reset()
        return ak(executorUrl, { method: 'GET' })
      })()
    )
  const submit = (payload) => run(ak(executorUrl, { method: 'POST', body: payload ?? {} }))

  return { challenge, complete, user, loading, error, begin, submit }
}
