// Avatar management for the signed-in user: Gravatar, generated initials, or an
// uploaded picture.
//
// Unlike the flow-driven tabs, this goes through the app's own backend (authentik
// has no self-service avatar upload, and writing attributes.avatar needs the
// admin token). Whichever mode is chosen, what lands on the authentik user is a
// URL — never image bytes — so the value stays small and cacheable wherever
// authentik surfaces it (e.g. the OIDC `picture` claim):
//
//   • Gravatar mode → DELETE stores the computed Gravatar URL for the address.
//   • Initials mode → POST /avatar/initials stores a generated SVG and its URL.
//   • Upload mode   → POST stores the (backend-normalised) image and its URL.
//
// The backend enforces the real limits; the checks here just give fast feedback.

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_BYTES = 10 * 1024 * 1024

function readAsDataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Could not read that file'))
    reader.readAsDataURL(file)
  })
}

// Mirrors the backend's mode detection (routes/avatar.js): the stored avatar is
// always a URL, so its shape is what says which mode produced it — a gravatar.com
// URL, one of our generated `…-avatar-initials-….svg` objects, or an upload. The
// `data:image/svg+xml` case covers both values written by earlier versions and the
// dev-only fallback below (initialsAvatarDataUri), neither of which the backend
// ever sends now.
const INITIALS_PREFIX = 'data:image/svg+xml'

function modeFor(avatar) {
  if (!avatar) {
    return 'gravatar'
  }
  if (/^https:\/\/(www\.)?gravatar\.com\//.test(avatar)) {
    return 'gravatar'
  }
  if (avatar.startsWith(INITIALS_PREFIX) || /-avatar-initials-[^/]*\.svg$/.test(avatar)) {
    return 'initials'
  }
  return 'upload'
}

// Dev-only Gravatar preview. The backend computes the authoritative URL (MD5, to
// match authentik); the Web Crypto API can't do MD5, but Gravatar also accepts a
// SHA-256 hash and resolves it to the same person's image — good enough for a
// no-live-session dev preview.
async function devGravatar(email) {
  const data = new TextEncoder().encode(String(email ?? '').trim().toLowerCase())
  const digest = await crypto.subtle.digest('SHA-256', data)
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `https://www.gravatar.com/avatar/${hash}?s=256&d=mp`
}

export function useAvatar() {
  const api = useApi()
  const auth = useAuthStore()

  // 'gravatar' | 'upload' | 'initials' — which source is currently active.
  const mode = ref('gravatar')
  // The avatar authentik resolves right now (for display).
  const current = ref(null)
  // The Gravatar URL to preview/offer.
  const gravatar = ref(null)
  // The custom uploaded URL, if any.
  const uploaded = ref(null)

  const loading = ref(false)
  const saving = ref(false)
  const error = ref(null)
  const saved = ref(false)
  // Set when we fall back to a local-only change (dev, no live authentik session).
  const usingSample = ref(false)

  function applyStatus(status) {
    mode.value = status.mode ?? 'gravatar'
    current.value = status.current ?? null
    gravatar.value = status.gravatar ?? gravatar.value
    uploaded.value = status.uploaded ?? null
  }

  function validate(file) {
    if (!file) {
      return 'Please choose an image.'
    }
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return 'Unsupported image type — use PNG, JPEG or WebP.'
    }
    if (file.size > MAX_BYTES) {
      return 'That image is too large — please use one under 10 MB.'
    }
    return null
  }

  async function load() {
    loading.value = true
    error.value = null
    saved.value = false
    usingSample.value = false
    try {
      applyStatus(await api('/avatar'))
    } catch (e) {
      if (import.meta.dev) {
        // No live authentik session in dev — reflect what the store knows so the
        // tab is still workable (see useApplications for the same pattern).
        const custom = auth.user?.avatar || null
        const resolved = modeFor(custom)
        current.value = custom
        uploaded.value = resolved === 'upload' ? custom : null
        gravatar.value = await devGravatar(auth.user?.email).catch(() => null)
        mode.value = resolved
        usingSample.value = true
      } else {
        error.value =
          e?.data?.error || e?.data?.detail || e?.message || 'We could not load your avatar settings.'
      }
    } finally {
      loading.value = false
    }
  }

  async function upload(file) {
    saved.value = false
    error.value = null
    const problem = validate(file)
    if (problem) {
      error.value = problem
      return false
    }
    saving.value = true
    try {
      const image = await readAsDataUri(file)
      const res = await api('/avatar', { method: 'POST', body: { image } })
      applyStatus({ mode: 'upload', current: res.avatar, uploaded: res.avatar })
      auth.setUser({ ...auth.user, avatar: res.avatar })
      await auth.fetchSession().catch(() => {})
      saved.value = true
      return true
    } catch (e) {
      if (import.meta.dev) {
        const image = await readAsDataUri(file).catch(() => null)
        if (image) {
          applyStatus({ mode: 'upload', current: image, uploaded: image })
          auth.setUser({ ...auth.user, avatar: image })
          usingSample.value = true
          saved.value = true
          return true
        }
      }
      error.value =
        e?.data?.error || e?.data?.detail || e?.message || 'We could not update your avatar.'
      return false
    } finally {
      saving.value = false
    }
  }

  async function useGravatar() {
    saved.value = false
    error.value = null
    saving.value = true
    try {
      const res = await api('/avatar', { method: 'DELETE' })
      applyStatus({ mode: 'gravatar', current: res.avatar, uploaded: null, gravatar: res.avatar })
      auth.setUser({ ...auth.user, avatar: res.avatar })
      await auth.fetchSession().catch(() => {})
      saved.value = true
      return true
    } catch (e) {
      if (import.meta.dev) {
        applyStatus({ mode: 'gravatar', current: gravatar.value, uploaded: null })
        auth.setUser({ ...auth.user, avatar: gravatar.value })
        usingSample.value = true
        saved.value = true
        return true
      }
      error.value =
        e?.data?.error || e?.data?.detail || e?.message || 'We could not switch to Gravatar.'
      return false
    } finally {
      saving.value = false
    }
  }

  async function useInitials() {
    saved.value = false
    error.value = null
    saving.value = true
    try {
      const res = await api('/avatar/initials', { method: 'POST' })
      applyStatus({ mode: 'initials', current: res.avatar, uploaded: null })
      auth.setUser({ ...auth.user, avatar: res.avatar })
      await auth.fetchSession().catch(() => {})
      saved.value = true
      return true
    } catch (e) {
      if (import.meta.dev) {
        const avatar = initialsAvatarDataUri(auth.user)
        applyStatus({ mode: 'initials', current: avatar, uploaded: null })
        auth.setUser({ ...auth.user, avatar })
        usingSample.value = true
        saved.value = true
        return true
      }
      error.value =
        e?.data?.error || e?.data?.detail || e?.message || 'We could not switch to initials.'
      return false
    } finally {
      saving.value = false
    }
  }

  return {
    mode,
    current,
    gravatar,
    uploaded,
    loading,
    saving,
    error,
    saved,
    usingSample,
    load,
    upload,
    useGravatar,
    useInitials
  }
}
