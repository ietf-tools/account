// The signed-in user's recovery email addresses (`attributes.recovery_emails` on
// the authentik user): list, request an addition (verified by email), and remove.
//
// Goes through the app backend because the browser can't read user attributes at
// all — /core/users/me/ omits `attributes` — and can't write them either; both need
// the admin token. See backend/routes/recovery-emails.ts.

export function useRecoveryEmails() {
  const api = useApi()

  const emails = ref([])
  const loading = ref(false)
  const error = ref(null)
  // The address currently being removed, so a row can show its own progress.
  const removing = ref(null)
  // How many addresses the account may hold. The backend owns the number; 0 means
  // "not loaded yet", so the UI doesn't act on a limit it hasn't been told.
  const max = ref(0)
  // An address awaiting confirmation, if any. There is at most one — requesting
  // another supersedes it — so the page can name it rather than leaving the user
  // wondering where their request went.
  const pending = ref(null)
  const atCap = computed(() => max.value > 0 && emails.value.length >= max.value)

  async function load() {
    loading.value = true
    error.value = null
    try {
      const body = await api('/recovery-emails')
      emails.value = Array.isArray(body?.emails) ? body.emails : []
      max.value = Number(body?.max) || 0
      pending.value = body?.pending || null
    } catch (e) {
      emails.value = []
      error.value =
        e?.data?.error ||
        e?.data?.detail ||
        e?.message ||
        'We could not load your recovery email addresses.'
    } finally {
      loading.value = false
    }
  }

  // Ask the backend to email a confirmation link to `email`. Nothing is added to
  // the list until that link is opened and confirmed (verify-recovery-email.vue) —
  // the only local change is that this becomes the pending address, replacing any
  // earlier one. Throws on failure.
  async function requestAdd(email) {
    const body = await api('/recovery-emails', { method: 'POST', body: { email } })
    pending.value = body?.email || email
    return pending.value
  }

  // Throws on failure so the caller can surface it next to the row it came from —
  // same contract as useTokens().remove and useConnectedSources().disconnect.
  async function remove(email) {
    removing.value = email
    try {
      // The backend answers with the list as it now stands, so a stale local copy
      // (an address removed in another tab) is corrected by the removal itself.
      const body = await api(`/recovery-emails/${encodeURIComponent(email)}`, {
        method: 'DELETE'
      })
      if (Array.isArray(body?.emails)) {
        emails.value = body.emails
      }
    } finally {
      removing.value = null
    }
  }

  return { emails, loading, error, removing, max, pending, atCap, load, requestAdd, remove }
}
