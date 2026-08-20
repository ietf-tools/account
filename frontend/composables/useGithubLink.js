// The GitHub username stored on the signed-in user's authentik attributes
// (`attributes.github`), plus a way to (re)resolve it from their linked GitHub
// connection.
//
// This goes through the app backend rather than authentik directly, for two
// reasons: writing user attributes needs the admin token, and the browser can't
// even read them (/core/users/me/ omits `attributes`). The attribute is normally
// written by a source property mapping when someone signs up or signs in *with*
// GitHub — linking GitHub while already signed in runs no flow, so it stays empty
// until this refresh fills it in. See backend/routes/github.ts.

export function useGithubLink() {
  const api = useApi()

  const username = ref(null)
  const refreshing = ref(false)
  const error = ref(null)
  // Whether this account has opted out of signing in with GitHub while staying
  // linked. Same storage (`attributes.github`), same reason for going through the
  // backend — but it's authentik's source-flow policy that enforces it, not us.
  // See backend/routes/github.ts.
  const loginDisabled = ref(false)
  const updating = ref(false)

  // Best-effort: the page works fine without it (the refresh button is how a user
  // recovers), so a failure here just means "nothing on file".
  async function load() {
    try {
      const body = await api('/github')
      username.value = body?.username || null
      loginDisabled.value = Boolean(body?.loginDisabled)
    } catch {
      username.value = null
      loginDisabled.value = false
    }
  }

  async function refresh() {
    refreshing.value = true
    error.value = null
    try {
      const body = await api('/github/refresh', { method: 'POST' })
      username.value = body?.username || null
      return true
    } catch (e) {
      error.value =
        e?.data?.error ||
        e?.data?.detail ||
        e?.message ||
        'We could not look up your GitHub username.'
      return false
    } finally {
      refreshing.value = false
    }
  }

  async function setLoginDisabled(disabled) {
    updating.value = true
    error.value = null
    try {
      const body = await api('/github/login-disabled', {
        method: 'POST',
        body: { disabled }
      })
      loginDisabled.value = Boolean(body?.loginDisabled)
      return true
    } catch (e) {
      error.value =
        e?.data?.error ||
        e?.data?.detail ||
        e?.message ||
        'We could not update your GitHub sign-in setting.'
      return false
    } finally {
      updating.value = false
    }
  }

  return { username, refreshing, error, loginDisabled, updating, load, refresh, setLoginDisabled }
}
