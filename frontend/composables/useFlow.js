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
// `options`:
//   resume — RESUME the plan authentik already has in the session instead of
//     cancelling it first. Set this when a third-party app initiated the flow
//     (authentik redirected the browser to /if/flow/<slug>/?client_id=… and we
//     intercepted it): the plan carries the OAuth request, so cancelling would
//     drop it and the app would never get its code.
//   query — the flow page's original querystring (client_id=…&redirect_uri=…),
//     forwarded to the executor exactly as authentik's stock flow UI would.
export function useFlow(kind, options = {}) {
  const ak = useAuthentik()
  const runtime = useRuntimeConfig()
  const defaultSlug = runtime.public.flows[kind]

  const resume = Boolean(options.resume)
  const query = options.query ?? ''

  const challenge = ref(null)
  const complete = ref(false)
  const user = ref(null)
  // Where authentik wants the browser to go once the flow finishes (the terminal
  // xak-flow-redirect's `to`). For a provider-initiated flow this is the
  // continuation back to the third-party app; for a standalone login it's an
  // authentik default we ignore in favour of our own home page.
  const redirectTo = ref(null)
  const loading = ref(false)
  const error = ref(null)

  // The flow currently being driven. Normally `kind`'s slug, but a passwordless
  // (passkey) login switches this to authentik's passwordless flow mid-session
  // (see beginFlow). `submit` always targets whichever flow is active.
  const activeSlug = ref(defaultSlug)

  // The executor URL for a given flow slug. `query` mirrors the flow page's
  // querystring; empty is what a fresh, headless start uses.
  const executorUrl = (slug) => `/flows/executor/${slug}/?query=${encodeURIComponent(query)}`
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
      redirectTo.value = next.to ?? null
      // In resume (provider) mode the caller follows redirectTo, so resolving the
      // local user is best-effort — don't let it fail the flow.
      user.value = await resolveUser().catch(() => null)
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
        activeSlug.value = defaultSlug
        if (!resume) {
          await reset()
        }
        return ak(executorUrl(activeSlug.value), { method: 'GET' })
      })()
    )

  // Start a *different* flow by slug in the current session — used for authentik's
  // passwordless (passkey) login, whose slug the identification challenge hands us
  // via passwordless_url. Always a fresh standalone start (never a resume: there's
  // no OAuth plan to preserve), so discard any in-progress plan first.
  const beginFlow = (altSlug) =>
    run(
      (async () => {
        activeSlug.value = altSlug
        await reset()
        return ak(executorUrl(altSlug), { method: 'GET' })
      })()
    )

  const submit = (payload) =>
    run(ak(executorUrl(activeSlug.value), { method: 'POST', body: payload ?? {} }))

  return { challenge, complete, user, redirectTo, loading, error, begin, beginFlow, submit }
}
