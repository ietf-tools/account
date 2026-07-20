// The signed-in user's linked social logins (OAuth sources: Google, GitHub,
// Apple) and the ones they could still connect.
//
// Existing connections come from /sources/user_connections/oauth/ (NOT
// owner-scoped for a superuser, so filter by user__username). The set of
// *connectable* providers, however, can't be reliably discovered per-user from
// the API (the sources-list endpoint is permission-gated and may only surface
// some), so we drive it from the fixed provider list below — there are only ever
// these three — and show whichever aren't connected yet. When the sources list
// *is* readable we use it to pick up each provider's real authentik slug.
//
// Linking/unlinking can only really be exercised in prod (same-origin); the
// dev-mock fallback stands in while iterating locally.

// The social providers this deployment offers. `slug` is the default authentik
// source slug used to build the connect URL (/source/oauth/login/<slug>/); it's
// overridden by the real slug from the sources list when that's available. The
// slug also doubles as the brand key SourceIcon matches on.
const PROVIDERS = [
  { slug: 'apple', name: 'Apple' },
  { slug: 'github', name: 'GitHub' },
  { slug: 'google', name: 'Google' }
]

// Identify which provider a source/connection is, from its slug or name (instance
// slugs vary, e.g. "github-enterprise").
function brandOf(text) {
  const hay = (text ?? '').toLowerCase()
  if (hay.includes('github')) {
    return 'github'
  }
  if (hay.includes('google')) {
    return 'google'
  }
  if (hay.includes('apple')) {
    return 'apple'
  }
  return ''
}

// Providers not represented in `connectedList`, with real slugs substituted in
// where `realSlugByBrand` (built from the sources list) knows them.
function availableFrom(connectedList, realSlugByBrand) {
  const connectedBrands = new Set(
    connectedList.map((item) => brandOf(`${item.slug} ${item.name}`)).filter(Boolean)
  )
  return PROVIDERS.filter((provider) => !connectedBrands.has(provider.slug)).map((provider) => ({
    slug: realSlugByBrand?.get(provider.slug) ?? provider.slug,
    name: provider.name
  }))
}

// Dev-only placeholders (see useApplications for why). Never used in production.
const SAMPLE_CONNECTED = [
  {
    connectionPk: 'sample-conn-google',
    sourcePk: 'sample-src-google',
    name: 'Google',
    slug: 'google',
    identifier: 'nick@example.com',
    created: '2026-06-15T14:30:00Z'
  }
]

export function useConnectedSources() {
  const ak = useAuthentik()
  const auth = useAuthStore()

  const connected = ref([])
  const available = ref([])
  const loading = ref(false)
  const error = ref(null)
  const usingSample = ref(false)

  async function load() {
    loading.value = true
    error.value = null
    usingSample.value = false
    // Real slugs learned from the sources list (best-effort), keyed by brand.
    let realSlugByBrand = new Map()
    try {
      // Scope to the current user with `user=<pk>` — the filter authentik's own
      // admin UI uses on this endpoint (/sources/user_connections/all/, which
      // returns every source-connection type). We also guard client-side by pk in
      // case the serializer includes it, but trust the server filter when it
      // doesn't (so we never hide everything).
      const params = { page_size: 100 }
      if (auth.user?.pk) {
        params.user = auth.user.pk
      }
      const connsBody = await ak('/sources/user_connections/all/', { params })
      const myConnections = (connsBody.results ?? []).filter(
        (conn) =>
          conn.user == null || auth.user?.pk == null || String(conn.user) === String(auth.user.pk)
      )
      // Best-effort: resolve source metadata / real slugs. A non-privileged user
      // may not be able to read this; if so we fall back to the default slugs.
      const sourcesBody = await ak('/sources/oauth/', { params: { page_size: 100 } }).catch(
        () => null
      )

      const sources = sourcesBody?.results ?? []
      const sourceByPk = new Map(sources.map((source) => [source.pk, source]))
      realSlugByBrand = new Map()
      for (const source of sources) {
        const brand = brandOf(`${source.slug} ${source.name}`)
        if (brand && !realSlugByBrand.has(brand)) {
          realSlugByBrand.set(brand, source.slug)
        }
      }

      connected.value = myConnections.map((conn) => {
        // The /all/ endpoint embeds the expanded source as `source_obj`; prefer
        // it, falling back to the oauth sources map keyed by pk.
        const source = conn.source_obj ?? sourceByPk.get(conn.source) ?? {}
        return {
          connectionPk: conn.pk,
          sourcePk: conn.source,
          name: source.name || conn.identifier || 'Connected account',
          slug: source.slug || '',
          identifier: conn.identifier || '',
          created: conn.created || null
        }
      })
    } catch (e) {
      if (import.meta.dev) {
        connected.value = SAMPLE_CONNECTED
        usingSample.value = true
      } else {
        connected.value = []
        available.value = []
        error.value =
          e?.data?.detail || e?.message || 'We could not load your connected services.'
        loading.value = false
        return
      }
    }

    available.value = availableFrom(connected.value, realSlugByBrand)
    loading.value = false
  }

  async function disconnect(item) {
    if (usingSample.value) {
      connected.value = connected.value.filter((c) => c.connectionPk !== item.connectionPk)
      available.value = availableFrom(connected.value, new Map())
      return
    }
    await ak(`/sources/user_connections/oauth/${item.connectionPk}/`, { method: 'DELETE' })
    await load()
  }

  return { connected, available, loading, error, usingSample, load, disconnect }
}
