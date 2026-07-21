// Backs the "Go Passwordless" section on the password page. A user can drop the
// password from their account once they have another way in — a passkey or a
// linked social login. Detection reuses the same authentik data the MFA and
// Connected Services tabs load; the actual removal goes through the backend
// (POST /passwordless), which needs the admin token and re-checks eligibility
// server-side before blanking the password.

export function usePasswordless() {
  const api = useApi()
  const mfa = useMfa()
  const sources = useConnectedSources()

  const loading = ref(false)
  const removing = ref(false)
  const removed = ref(false)
  const error = ref(null)

  // A confirmed webauthn authenticator is a passkey or security key.
  const hasPasskeys = computed(() => {
    return mfa.devices.value.some((device) => device.kind === 'webauthn' && device.confirmed)
  })
  const hasSocial = computed(() => sources.connected.value.length > 0)
  const canRemove = computed(() => hasPasskeys.value || hasSocial.value)

  async function load() {
    loading.value = true
    error.value = null
    try {
      await Promise.all([mfa.load(), sources.load()])
    } finally {
      loading.value = false
    }
  }

  async function remove() {
    removing.value = true
    error.value = null
    try {
      await api('/passwordless', { method: 'POST' })
      removed.value = true
    } catch (e) {
      error.value =
        e?.data?.error || e?.data?.detail || e?.message || 'We could not remove your password.'
    } finally {
      removing.value = false
    }
  }

  return { hasPasskeys, hasSocial, canRemove, loading, removing, removed, error, load, remove }
}
