// Lists the applications the signed-in user can launch, straight from authentik's
// core API (same-origin in prod, dev-proxied otherwise) — the same data behind
// authentik's own user library. Returns reactive state plus a `load` action.
//
// authentik's /core/applications/ already evaluates this user's access policies,
// so the results are exactly what they're allowed to open. Each result carries a
// resolved `launch_url`, an optional `meta_icon`, a description, a publisher and a
// `group` (used to section the list, the way authentik does).

// Resolve an authentik-relative asset URL ("/media/application-icons/…") into an
// absolute one. Same-origin in prod, so window.location.origin is authentik's
// origin; already-absolute or data: URLs pass through untouched.
function absolutizeIcon(url) {
  if (!url) {
    return ''
  }
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:')) {
    return url
  }
  return `${window.location.origin}/${url.replace(/^\/+/, '')}`
}

// Dev-only placeholders. In dev the browser is on http://localhost and
// authentik's Secure session cookie may not stick (see CLAUDE.md), so a real
// session — and therefore a real app list — isn't guaranteed. To keep the view
// visible while iterating on it, fall back to these when dev has nothing to show.
// Never used in production.
const SAMPLE_APPS = [
  {
    pk: 'sample-datatracker',
    name: 'Datatracker',
    description: 'Track IETF drafts, RFCs, working groups and meeting materials.',
    publisher: 'IETF',
    group: 'IETF Tools',
    icon: '',
    launchUrl: 'https://datatracker.ietf.org',
    openInNewTab: true
  },
  {
    pk: 'sample-meetecho',
    name: 'Meetecho',
    description: 'Join and manage remote participation for IETF meeting sessions.',
    publisher: 'Meetecho',
    group: 'IETF Tools',
    icon: '',
    launchUrl: 'https://meetings.conf.meetecho.com',
    openInNewTab: true
  },
  {
    pk: 'sample-mailman',
    name: 'Mailman',
    description: 'Manage your subscriptions to IETF mailing lists.',
    publisher: 'IETF',
    group: 'Communication',
    icon: '',
    launchUrl: 'https://mailman3.ietf.org',
    openInNewTab: true
  },
  {
    pk: 'sample-wiki',
    name: 'Wiki',
    description: '',
    publisher: '',
    group: '',
    icon: '',
    launchUrl: 'https://wiki.ietf.org',
    openInNewTab: false
  }
]

function normalize(app) {
  return {
    pk: app.pk,
    name: app.name,
    description: app.meta_description || '',
    publisher: app.meta_publisher || '',
    group: app.group || '',
    icon: absolutizeIcon(app.meta_icon),
    launchUrl: app.launch_url || null,
    openInNewTab: Boolean(app.open_in_new_tab)
  }
}

export function useApplications() {
  const ak = useAuthentik()

  const apps = ref([])
  const loading = ref(false)
  const error = ref(null)
  // True when the list is dev placeholder data rather than the user's real apps.
  const usingSample = ref(false)

  async function load() {
    loading.value = true
    error.value = null
    usingSample.value = false
    try {
      const body = await ak('/core/applications/', { params: { page_size: 100 } })
      // Only apps with a launch URL are actionable; authentik's own library hides
      // the rest too.
      const results = (body.results ?? []).filter((app) => app.launch_url).map(normalize)
      if (results.length === 0 && import.meta.dev) {
        apps.value = SAMPLE_APPS
        usingSample.value = true
      } else {
        apps.value = results
      }
    } catch (e) {
      if (import.meta.dev) {
        // No live session in dev is expected — show placeholders instead of an error.
        apps.value = SAMPLE_APPS
        usingSample.value = true
      } else {
        apps.value = []
        error.value =
          e?.data?.detail || e?.message || 'We could not load your applications. Please try again.'
      }
    } finally {
      loading.value = false
    }
  }

  return { apps, loading, error, usingSample, load }
}
