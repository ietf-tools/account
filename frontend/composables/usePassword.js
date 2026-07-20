// Drives authentik's password-change flow (default-password-change, overridable
// via AUTHENTIK_FLOW_PASSWORD_CHANGE) so the signed-in user can set a new
// password. Like the profile flow it's a prompt stage — here the new-password
// fields — GET to read it, POST to submit; the flow's own password policies come
// back as field errors. Same dev-mock fallback as the other tabs.

export function usePassword() {
  const ak = useAuthentik()
  const runtime = useRuntimeConfig()
  const slug = runtime.public.flows.passwordChange

  const executorUrl = `/flows/executor/${slug}/?query=`
  const cancelUrl = flowsCancelUrl(runtime.public.authentikApiUrl)

  const fields = ref([])
  const values = reactive({})
  const fieldErrors = ref({})
  const nonFieldErrors = ref([])

  const loading = ref(false)
  const saving = ref(false)
  const error = ref(null)
  const saved = ref(false)
  const usingSample = ref(false)
  const lastChallenge = ref(null)
  const lastComponent = computed(() => lastChallenge.value?.component ?? null)

  async function reset() {
    await fetch(cancelUrl, { method: 'GET', credentials: 'include', redirect: 'manual' }).catch(
      () => {}
    )
  }

  function applyChallenge(challenge) {
    lastChallenge.value = challenge ?? null
    if (challenge?.component === 'ak-stage-prompt') {
      const all = challenge.fields ?? []
      for (const key of Object.keys(values)) {
        delete values[key]
      }
      for (const field of all) {
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
      { field_key: 'password', label: 'New password', type: 'password', required: true, initial_value: '' },
      {
        field_key: 'password_repeat',
        label: 'Confirm new password',
        type: 'password',
        required: true,
        initial_value: ''
      }
    ]
    for (const field of sample) {
      values[field.field_key] = ''
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
        error.value = 'Changing your password is not available.'
      }
    } catch (e) {
      if (import.meta.dev) {
        applySample()
        usingSample.value = true
      } else {
        error.value = e?.data?.detail || e?.message || 'We could not load the password form.'
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
        applySample()
        saved.value = true
        return
      }
      const kind = applyChallenge(await ak(executorUrl, { method: 'POST', body: { ...values } }))
      if (kind === 'complete') {
        // Re-present a fresh (blank) prompt so the password fields clear.
        await fetchForm().catch(() => {})
        saved.value = true
      } else if (kind === 'other') {
        const detail = lastChallenge.value?.error
        const requestId = lastChallenge.value?.request_id
        error.value = detail
          ? `Couldn't change your password — authentik reported: ${detail}${requestId ? ` (request ${requestId})` : ''}`
          : `Couldn't change your password: the flow stopped on an unexpected step ("${lastComponent.value}").`
      } else if (
        Object.keys(fieldErrors.value).length === 0 &&
        nonFieldErrors.value.length === 0
      ) {
        error.value = 'Your password could not be changed. Please try again.'
      }
      // Otherwise kind === 'prompt' with errors, surfaced via fieldErrors.
    } catch (e) {
      error.value = e?.data?.detail || e?.message || 'We could not change your password.'
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
