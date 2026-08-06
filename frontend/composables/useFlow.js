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

  // Only the newest request may touch the state above. Requests CAN overlap: a
  // password manager filling a stage (1Password &c.) submits it twice often enough
  // — a disabled Continue button doesn't stop an Enter keypress in a field — and
  // authentik answers the duplicate for a stage its plan has already left behind.
  // Applying that late response over a newer one rewinds the UI to a stage the flow
  // is done with; worse, when the newer response was the terminal redirect it
  // overwrote the resolved `user` with null while `complete` stayed true, so the
  // consumer's one-shot completion watcher never fired again and the page sat on
  // "Signed in — redirecting…" forever.
  let generation = 0
  const stale = (mine) => mine !== generation
  const snapshot = () => ({
    challenge: challenge.value,
    complete: complete.value,
    user: user.value
  })

  async function resolveUser() {
    // Flow reached xak-flow-redirect => the browser should now be authenticated in
    // authentik. Resolve who just signed in / enrolled.
    const body = await ak('/core/users/me/')
    const me = body.user ?? body
    // A terminal redirect is not proof of a session: authentik also ends a flow this
    // way when it turns out not to be applicable (a duplicate POST re-planning an
    // authentication flow the user is now already signed into, say), and
    // /core/users/me/ answers that with its AnonymousUser instead of failing. Report
    // "nobody" so the host page resolves the session itself rather than storing a
    // pseudo-user as the signed-in one.
    return isAnonymous(me) ? null : toSessionUser(me)
  }

  async function apply(next, mine) {
    const done = isFlowComplete(next)
    if (done) {
      // Resolve the signed-in user BEFORE flipping `complete`. `resolveUser` is an
      // async /core/users/me/ fetch; if we set `complete` first, the consumer's
      // completion watcher fires on the next microtask — before this resolves — and
      // sees `user` still null, treating a real login as a failure. In resume
      // (provider) mode the caller just follows redirectTo, so this stays
      // best-effort — don't let it fail the flow.
      const resolved = await resolveUser().catch(() => null)
      // Another request landed while we were resolving — it owns the state now.
      if (stale(mine)) {
        return snapshot()
      }
      redirectTo.value = next.to ?? null
      user.value = resolved
    }
    challenge.value = withSources(next)
    complete.value = done
    return snapshot()
  }

  async function run(request) {
    const mine = ++generation
    loading.value = true
    error.value = null
    try {
      const next = await request
      if (stale(mine)) {
        return snapshot()
      }
      return await apply(next, mine)
    } catch (e) {
      if (!stale(mine)) {
        error.value = e?.data?.detail || e?.data?.error || e?.message || 'Something went wrong'
      }
      throw e
    } finally {
      // A newer request owns `loading` (and will clear it) — don't report idle while
      // it's still in flight.
      if (!stale(mine)) {
        loading.value = false
      }
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

  // Answer the current stage. Drops a submit fired while one is already in flight:
  // one stage, one POST. Autofill-and-submit can otherwise send the same answer
  // twice, and the second POST reaches authentik after the plan has moved on — it
  // then answers a *different* stage than the user thinks they're on. (The
  // generation guard in `run` is the backstop for anything that still overlaps,
  // e.g. a begin racing a submit.)
  const submit = (payload) => {
    if (loading.value) {
      return Promise.resolve(snapshot())
    }
    return run(ak(executorUrl(activeSlug.value), { method: 'POST', body: payload ?? {} }))
  }

  return { challenge, complete, user, redirectTo, loading, error, begin, beginFlow, submit }
}
