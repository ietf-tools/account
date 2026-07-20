// The signed-in user's authentik API tokens (and app passwords), from authentik's
// core API. Like sessions, the list is NOT owner-scoped for a superuser, so we
// filter by `user__username`. authentik's Token viewset keys everything off the
// token `identifier` (not a pk), so that's what delete / view_key address. The
// token secret is never in the list payload — it's fetched on demand via
// view_key. Same dev-mock fallback as the other tabs.

// User-manageable token intents; the rest (recovery/verification) are internal.
const USER_INTENTS = new Set(['api', 'app_password'])

function normalize(token) {
  return {
    identifier: token.identifier,
    intent: token.intent,
    description: token.description ?? '',
    expiring: Boolean(token.expiring),
    expires: token.expires ?? null
  }
}

// Dev-only placeholders (see useApplications for why). Never used in production.
const SAMPLE_TOKENS = [
  {
    identifier: 'ci-pipeline',
    intent: 'api',
    description: 'Datatracker CI pipeline',
    expiring: false,
    expires: null
  },
  {
    identifier: 'imap-mail',
    intent: 'app_password',
    description: 'IMAP mail access',
    expiring: true,
    expires: '2026-12-31T00:00:00Z'
  }
]

export function useTokens() {
  const ak = useAuthentik()
  const auth = useAuthStore()

  const tokens = ref([])
  const loading = ref(false)
  const error = ref(null)
  const usingSample = ref(false)

  async function load() {
    loading.value = true
    error.value = null
    usingSample.value = false
    try {
      // Scope to the current user (a superuser would otherwise get every token),
      // then keep only the user-manageable intents.
      const params = { page_size: 100 }
      if (auth.user?.username) {
        params.user__username = auth.user.username
      }
      const body = await ak('/core/tokens/', { params })
      tokens.value = (body.results ?? [])
        .filter((token) => USER_INTENTS.has(token.intent))
        .map(normalize)
    } catch (e) {
      if (import.meta.dev) {
        tokens.value = SAMPLE_TOKENS.map(normalize)
        usingSample.value = true
      } else {
        tokens.value = []
        error.value =
          e?.data?.detail || e?.message || 'We could not load your tokens. Please try again.'
      }
    } finally {
      loading.value = false
    }
  }

  // Create an API token. authentik assigns it to the requesting user. When
  // `expiring` is set, `expires` is an ISO datetime string.
  async function create({ identifier, description, expiring, expires }) {
    const willExpire = Boolean(expiring)
    if (usingSample.value) {
      tokens.value = [
        normalize({
          identifier,
          intent: 'api',
          description,
          expiring: willExpire,
          expires: willExpire ? expires : null
        }),
        ...tokens.value
      ]
      return
    }
    const body = { identifier, description: description ?? '', intent: 'api', expiring: willExpire }
    if (willExpire && expires) {
      body.expires = expires
    }
    const created = await ak('/core/tokens/', { method: 'POST', body })
    tokens.value = [normalize(created), ...tokens.value]
  }

  async function remove(identifier) {
    if (!usingSample.value) {
      await ak(`/core/tokens/${encodeURIComponent(identifier)}/`, { method: 'DELETE' })
    }
    tokens.value = tokens.value.filter((token) => token.identifier !== identifier)
  }

  // Reveal a token's secret. Only fetched when the user explicitly asks (copy),
  // never held in the list.
  async function viewKey(identifier) {
    if (usingSample.value) {
      return `sample-key-${identifier}`
    }
    const body = await ak(`/core/tokens/${encodeURIComponent(identifier)}/view_key/`)
    return body.key
  }

  return { tokens, loading, error, usingSample, load, create, remove, viewKey }
}
