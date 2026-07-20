// The signed-in user's MFA authenticators (TOTP apps, passkeys/security keys,
// recovery codes, …), from authentik's authenticators API.
//
// /authenticators/all/ is already scoped to the requesting user server-side
// (devices_for_user), so — unlike sessions/tokens — no user filter is needed.
// Deleting a device, however, goes through its per-type endpoint
// (/authenticators/<kind>/<id>/), so we derive the `kind` from the device's
// model `type`. Same dev-mock fallback as the other tabs.

// Friendly label per authenticator kind.
const KIND_LABELS = {
  totp: 'Authenticator app (TOTP)',
  webauthn: 'Passkey or security key',
  static: 'Recovery codes',
  duo: 'Duo push',
  sms: 'SMS code',
  email: 'Email code'
}

// authentik reports `type` as a model label like
// "authentik_stages_authenticator_totp.TOTPDevice". Derive the URL segment /
// kind from it. The segment doubles as the per-type API path.
function deviceKind(type) {
  const value = (type ?? '').toLowerCase()
  for (const kind of ['webauthn', 'totp', 'static', 'duo', 'sms', 'email']) {
    if (value.includes(kind)) {
      return kind
    }
  }
  return ''
}

function normalize(device) {
  const kind = deviceKind(device.type)
  return {
    pk: device.pk,
    name: device.name || device.verbose_name || 'Authenticator',
    kind,
    kindLabel: KIND_LABELS[kind] ?? device.verbose_name ?? 'Authenticator',
    confirmed: device.confirmed !== false
  }
}

// Dev-only placeholders (see useApplications for why). Never used in production.
const SAMPLE_DEVICES = [
  { pk: 1, name: 'iPhone', type: 'authentik_stages_authenticator_totp.TOTPDevice', confirmed: true },
  {
    pk: 2,
    name: 'YubiKey 5C',
    type: 'authentik_stages_authenticator_webauthn.WebAuthnDevice',
    confirmed: true
  },
  {
    pk: 3,
    name: 'Recovery codes',
    type: 'authentik_stages_authenticator_static.StaticDevice',
    confirmed: true
  }
]

export function useMfa() {
  const ak = useAuthentik()

  const devices = ref([])
  const loading = ref(false)
  const error = ref(null)
  const usingSample = ref(false)

  async function load() {
    loading.value = true
    error.value = null
    usingSample.value = false
    try {
      const body = await ak('/authenticators/all/')
      // This endpoint returns a plain array (not paginated).
      const results = Array.isArray(body) ? body : (body.results ?? [])
      devices.value = results.map(normalize)
    } catch (e) {
      if (import.meta.dev) {
        devices.value = SAMPLE_DEVICES.map(normalize)
        usingSample.value = true
      } else {
        devices.value = []
        error.value =
          e?.data?.detail || e?.message || 'We could not load your authenticators. Please try again.'
      }
    } finally {
      loading.value = false
    }
  }

  async function remove(device) {
    if (!device.kind) {
      throw new Error('Unknown authenticator type — cannot remove it here.')
    }
    if (!usingSample.value) {
      await ak(`/authenticators/${device.kind}/${device.pk}/`, { method: 'DELETE' })
    }
    devices.value = devices.value.filter((d) => d.pk !== device.pk || d.kind !== device.kind)
  }

  return { devices, loading, error, usingSample, load, remove }
}
