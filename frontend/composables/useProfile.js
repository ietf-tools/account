// Drives authentik's user-settings flow (default-user-settings-flow) to let the
// signed-in user edit their own details — name, email, and whatever custom
// prompt fields the flow defines (e.g. pronouns). authentik has no writable
// self-serializer; profile edits go through this flow's prompt stage, exactly as
// authentik's own settings page does.
//
// We talk to the executor directly (like useFlow): GET returns the prompt
// challenge (fields + current values); POST submits the new values and, on
// success, the flow completes with xak-flow-redirect. Field-level validation
// comes back as response_errors on a re-presented prompt. Same dev-mock fallback
// as the other tabs.

export function useProfile() {
  const ak = useAuthentik()
  const auth = useAuthStore()
  const runtime = useRuntimeConfig()
  const slug = runtime.public.flows.userSettings

  const executorUrl = `/flows/executor/${slug}/?query=`
  const cancelUrl = flowsCancelUrl(runtime.public.authentikApiUrl)

  // Visible prompt fields (hidden ones are still submitted from `values`).
  const fields = ref([])
  const values = reactive({})
  const fieldErrors = ref({})
  const nonFieldErrors = ref([])

  const loading = ref(false)
  const saving = ref(false)
  const error = ref(null)
  const saved = ref(false)
  const usingSample = ref(false)
  // The last challenge seen — used to explain a flow that stops on an unexpected
  // step. authentik's ak-stage-flow-error carries an `error` string (populated for
  // superusers / debug) and a `request_id` we can point at.
  const lastChallenge = ref(null)
  const lastComponent = computed(() => lastChallenge.value?.component ?? null)

  // Discard any half-finished plan so a fresh GET re-presents the prompt from the
  // top (mirrors useFlow.reset()).
  async function reset() {
    await fetch(cancelUrl, { method: 'GET', credentials: 'include', redirect: 'manual' }).catch(
      () => {}
    )
  }

  // Read a challenge into local state. Returns 'prompt' | 'complete' | 'other'.
  function applyChallenge(challenge) {
    lastChallenge.value = challenge ?? null
    if (challenge?.component === 'ak-stage-prompt') {
      const all = challenge.fields ?? []
      // Rebuild the submitted payload from scratch so stale keys from a previous
      // stage never leak into this submit. `static` fields are display-only — they
      // must NOT be sent, or they pollute the flow's prompt_data / user_write.
      for (const key of Object.keys(values)) {
        delete values[key]
      }
      for (const field of all) {
        // Only submit fields the user can actually edit. `static` is display-only,
        // and `hidden` fields are pre-filled immutable values (e.g. username) —
        // echoing those back makes user_write reject the write ("Not allowed to
        // change username"). Skip both so only visible inputs are sent.
        if (field.type === 'static' || field.type === 'hidden') {
          continue
        }
        values[field.field_key] = field.initial_value ?? (field.type === 'checkbox' ? false : '')
      }
      fields.value = all.filter((field) => field.type !== 'hidden')
      fieldErrors.value = challenge.response_errors ?? {}
      nonFieldErrors.value = challenge.response_errors?.non_field_errors ?? []
      return 'prompt'
    }
    if (isFlowComplete(challenge)) {
      return 'complete'
    }
    return 'other'
  }

  async function fetchForm() {
    await reset()
    return applyChallenge(await ak(executorUrl, { method: 'GET' }))
  }

  // Dev-only placeholder form (see useApplications for why). Never in production.
  function applySample() {
    const sample = [
      { field_key: 'name', label: 'Name', type: 'text', initial_value: auth.user?.name || 'Jane Doe' },
      {
        field_key: 'email',
        label: 'Email',
        type: 'email',
        initial_value: auth.user?.email || 'jane@example.com'
      },
      {
        field_key: 'attributes.pronouns',
        label: 'Pronouns',
        type: 'text',
        placeholder: 'e.g. they/them',
        initial_value: 'they/them'
      }
    ]
    for (const field of sample) {
      values[field.field_key] = field.initial_value
    }
    fields.value = sample
    fieldErrors.value = {}
    nonFieldErrors.value = []
  }

  async function load() {
    loading.value = true
    error.value = null
    saved.value = false
    usingSample.value = false
    try {
      if ((await fetchForm()) === 'other') {
        error.value = 'Profile editing is not available.'
      }
    } catch (e) {
      if (import.meta.dev) {
        applySample()
        usingSample.value = true
      } else {
        error.value = e?.data?.detail || e?.message || 'We could not load your profile.'
      }
    } finally {
      loading.value = false
    }
  }

  async function save() {
    saving.value = true
    error.value = null
    saved.value = false
    fieldErrors.value = {}
    nonFieldErrors.value = []
    try {
      if (usingSample.value) {
        saved.value = true
        return
      }
      const kind = applyChallenge(await ak(executorUrl, { method: 'POST', body: { ...values } }))
      if (kind === 'complete') {
        // Name/email may have changed — refresh identity (updates the sidebar),
        // then re-present the form with the new values.
        await auth.fetchSession()
        await fetchForm().catch(() => {})
        saved.value = true
      } else if (kind === 'other') {
        // Flow stopped on a step we don't drive here (e.g. a re-auth or email
        // verification stage) — say so instead of failing silently. For an
        // ak-stage-flow-error, authentik hands superusers the real error text.
        const detail = lastChallenge.value?.error
        const requestId = lastChallenge.value?.request_id
        error.value = detail
          ? `Couldn't save — authentik reported: ${detail}${requestId ? ` (request ${requestId})` : ''}`
          : `Couldn't save: the settings flow stopped on an unexpected step ("${lastComponent.value}").`
      } else if (
        Object.keys(fieldErrors.value).length === 0 &&
        nonFieldErrors.value.length === 0
      ) {
        // Prompt re-presented with no field errors: nothing was saved, but there's
        // nothing to point at either.
        error.value = 'Your changes could not be saved. Please try again.'
      }
      // Otherwise kind === 'prompt' with errors, now surfaced via fieldErrors.
    } catch (e) {
      error.value = e?.data?.detail || e?.message || 'We could not save your changes.'
    } finally {
      saving.value = false
    }
  }

  function errorFor(key) {
    return fieldErrors.value?.[key]?.map((item) => item.string).join(' ')
  }

  return {
    fields,
    values,
    nonFieldErrors,
    loading,
    saving,
    error,
    saved,
    usingSample,
    load,
    save,
    errorFor
  }
}
