// The unauthenticated account-recovery flow: prove control of a confirmed recovery
// address, then adopt it as the account's primary email and set a new password.
//
// Entirely backend-driven (see backend/routes/account-recovery.js) — it changes a
// user's email, username and password, none of which the browser can do, and it
// runs with no session at all. The signed link mailed in step one is the only
// authorisation.

export function useAccountRecovery() {
  const api = useApi()

  // Step 1. Resolves the same way whether or not anything matched — the backend
  // deliberately doesn't say, so nothing here can leak it either. Throws only on a
  // malformed request or a transport failure.
  async function requestLink({ account, recovery }) {
    await api('/account-recovery', { method: 'POST', body: { account, recovery } })
  }

  // Step 2. The addresses this link may promote, for the confirmation page.
  async function loadOptions(token) {
    return await api('/account-recovery/options', { method: 'POST', body: { token } })
  }

  // Step 3. Applies the change; the account's email, username and password all
  // move at once. Throws with the backend's message on refusal.
  async function complete({ token, email, password }) {
    return await api('/account-recovery/complete', {
      method: 'POST',
      body: { token, email, password }
    })
  }

  return { requestLink, loadOptions, complete }
}
