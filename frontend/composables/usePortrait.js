// Portrait picture for the signed-in user: a higher-resolution, full-frame photo
// (any aspect ratio), upload-only. Companion to useAvatar() — same object-storage
// backend, but stored in a separate authentik field (attributes.portrait) and
// with no Gravatar/initials fallback.
//
// The backend normalises the image (aspect-preserving) and stores only its URL;
// this composable just uploads, removes, and tracks the current URL. The backend
// enforces the real limits; the checks here give fast feedback.

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_BYTES = 15 * 1024 * 1024

function readAsDataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Could not read that file'))
    reader.readAsDataURL(file)
  })
}

export function usePortrait() {
  const api = useApi()

  const current = ref(null)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref(null)
  const saved = ref(false)
  const usingSample = ref(false)

  function validate(file) {
    if (!file) {
      return 'Please choose an image.'
    }
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return 'Unsupported image type — use PNG, JPEG or WebP.'
    }
    if (file.size > MAX_BYTES) {
      return 'That image is too large — please use one under 15 MB.'
    }
    return null
  }

  async function load() {
    loading.value = true
    error.value = null
    saved.value = false
    usingSample.value = false
    try {
      const status = await api('/portrait')
      current.value = status.portrait ?? null
    } catch (e) {
      if (import.meta.dev) {
        // No live authentik session in dev — start empty and let uploads reflect
        // locally (see useApplications for the same pattern).
        usingSample.value = true
      } else {
        error.value =
          e?.data?.error || e?.data?.detail || e?.message || 'We could not load your portrait.'
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
      const res = await api('/portrait', { method: 'POST', body: { image } })
      current.value = res.portrait
      saved.value = true
      return true
    } catch (e) {
      if (import.meta.dev) {
        const image = await readAsDataUri(file).catch(() => null)
        if (image) {
          current.value = image
          usingSample.value = true
          saved.value = true
          return true
        }
      }
      error.value =
        e?.data?.error || e?.data?.detail || e?.message || 'We could not update your portrait.'
      return false
    } finally {
      saving.value = false
    }
  }

  async function remove() {
    saved.value = false
    error.value = null
    saving.value = true
    try {
      await api('/portrait', { method: 'DELETE' })
      current.value = null
      saved.value = true
      return true
    } catch (e) {
      if (import.meta.dev) {
        current.value = null
        usingSample.value = true
        saved.value = true
        return true
      }
      error.value =
        e?.data?.error || e?.data?.detail || e?.message || 'We could not remove your portrait.'
      return false
    } finally {
      saving.value = false
    }
  }

  return { current, loading, saving, error, saved, usingSample, load, upload, remove }
}
