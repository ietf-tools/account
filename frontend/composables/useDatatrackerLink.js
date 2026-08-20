// Whether the signed-in account is already linked to a legacy Datatracker account
// (`attributes.datatracker.linked` on the authentik user).
//
// Goes through the app backend because the browser can't read user attributes at
// all — /core/users/me/ omits `attributes`, so reading the flag needs the admin
// token. See backend/routes/datatracker.ts.

export function useDatatrackerLink() {
  const api = useApi()

  const linked = ref(false)
  // Distinguishes "not linked" from "haven't asked yet", so the migration CTA
  // isn't flashed at users who turn out to be linked already.
  const loaded = ref(false)

  // Best-effort: if we can't tell, fall back to "not linked" and let the
  // migration flow itself refuse a duplicate — better than hiding the only way
  // in from someone who needs it.
  async function load() {
    try {
      const body = await api('/datatracker')
      linked.value = Boolean(body?.linked)
    } catch {
      linked.value = false
    } finally {
      loaded.value = true
    }
  }

  return { linked, loaded, load }
}
