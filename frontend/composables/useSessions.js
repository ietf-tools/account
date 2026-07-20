// The signed-in user's active authentik sessions, from authentik's core API. The
// list endpoint is owner-scoped (a non-admin only ever sees their own sessions),
// and each can be terminated with a DELETE. Same dev-mock fallback shape as
// useApplications(): when dev has no live session, show placeholders so the view
// is still workable.

// Turn authentik's session record into the trimmed shape the page renders.
// authentik parses the stored user-agent into `user_agent` ({ user_agent, os })
// and resolves `geo_ip`; both can be absent, so fall back gracefully.
function normalize(session) {
  const ua = session.user_agent ?? {}
  const geo = session.geo_ip ?? null
  const location = geo ? [geo.city, geo.country].filter(Boolean).join(', ') : ''
  return {
    uuid: session.uuid,
    current: Boolean(session.current),
    ip: session.last_ip ?? '',
    browser: ua.user_agent?.family ?? '',
    os: ua.os?.family ?? '',
    rawUserAgent: session.last_user_agent ?? '',
    location,
    // ISO 3166-1 alpha-2 country code (e.g. "US"), used to render a flag emoji.
    countryCode: geo?.country ?? '',
    lastUsed: session.last_used ?? null,
    expires: session.expires ?? null
  }
}

// Current session first, then most-recently-used.
function order(sessions) {
  return [...sessions].sort((a, b) => {
    if (a.current !== b.current) {
      return a.current ? -1 : 1
    }
    return String(b.lastUsed ?? '').localeCompare(String(a.lastUsed ?? ''))
  })
}

// Dev-only placeholders (see useApplications for why). Never used in production.
const SAMPLE_SESSIONS = order([
  {
    uuid: 'sample-current',
    current: true,
    ip: '198.51.100.24',
    browser: 'Chrome',
    os: 'Mac OS X',
    rawUserAgent: '',
    location: 'San Francisco, US',
    countryCode: 'US',
    lastUsed: '2026-07-20T09:12:00Z',
    expires: '2026-08-19T09:12:00Z'
  },
  {
    uuid: 'sample-firefox',
    current: false,
    ip: '203.0.113.7',
    browser: 'Firefox',
    os: 'Windows',
    rawUserAgent: '',
    location: 'Amsterdam, NL',
    countryCode: 'NL',
    lastUsed: '2026-07-18T21:40:00Z',
    expires: '2026-08-17T21:40:00Z'
  },
  {
    uuid: 'sample-safari',
    current: false,
    ip: '192.0.2.55',
    browser: 'Safari',
    os: 'iOS',
    rawUserAgent: '',
    location: '',
    lastUsed: '2026-07-15T06:05:00Z',
    expires: '2026-08-14T06:05:00Z'
  }
])

export function useSessions() {
  const ak = useAuthentik()
  const auth = useAuthStore()

  const sessions = ref([])
  const loading = ref(false)
  const error = ref(null)
  const usingSample = ref(false)

  async function load() {
    loading.value = true
    error.value = null
    usingSample.value = false
    try {
      // Scope to the current user: for a superuser this endpoint returns EVERY
      // user's sessions, so we filter to just their own. The supported filter is
      // `user__username` (a bare `user`/pk param is ignored), matching the call
      // authentik's own admin UI makes.
      const params = { page_size: 100 }
      if (auth.user?.username) {
        params.user__username = auth.user.username
      }
      const body = await ak('/core/authenticated_sessions/', { params })
      sessions.value = order((body.results ?? []).map(normalize))
    } catch (e) {
      if (import.meta.dev) {
        sessions.value = SAMPLE_SESSIONS
        usingSample.value = true
      } else {
        sessions.value = []
        error.value =
          e?.data?.detail || e?.message || 'We could not load your sessions. Please try again.'
      }
    } finally {
      loading.value = false
    }
  }

  // Terminate one session. In sample (dev) mode there's nothing server-side to
  // delete, so just drop it locally.
  async function revoke(uuid) {
    if (!usingSample.value) {
      await ak(`/core/authenticated_sessions/${uuid}/`, { method: 'DELETE' })
    }
    sessions.value = sessions.value.filter((session) => session.uuid !== uuid)
  }

  return { sessions, loading, error, usingSample, load, revoke }
}
