<script setup>
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import QRCode from 'qrcode'
// Renders an authentik flow as a sequence of challenges and submits each stage
// straight to authentik's Flow Executor (see useFlow). This is where you fully
// own the login UI: every stage below is just markup you control, driven by the
// challenge JSON authentik hands back. Add branches here as you enable more stages.
const props = defineProps({
  kind: { type: String, required: true }, // authentication | enrollment | recovery
  title: { type: String, default: '' },
  // Set when a third-party app initiated this flow (see login.vue): resume
  // authentik's existing plan instead of restarting, and on completion follow
  // its redirect back to the app rather than emitting `complete`.
  resume: { type: Boolean, default: false },
  // Drop the card chrome (outer card, title, "continue as") so the flow can be
  // hosted inside another panel — e.g. MFA enrollment in the account shell.
  embedded: { type: Boolean, default: false }
})
const emit = defineEmits(['complete'])

// Forward the page's OAuth querystring (client_id=…&redirect_uri=…) to the
// executor, exactly as authentik's stock flow UI does. Empty for a normal login.
const query = import.meta.client ? window.location.search.replace(/^\?/, '') : ''

const { challenge, complete, user, redirectTo, loading, error, begin, beginFlow, submit } = useFlow(props.kind, {
  resume: props.resume,
  query
})

// Local form model, reset whenever the stage changes.
const model = reactive({})
const component = computed(() => challenge.value?.component)

// --- Authenticator validation (MFA) --------------------------------------
// authentik's ak-stage-authenticator-validate offers one `device_challenge` per
// enrolled device, each keyed by `device_class`. Code devices (TOTP/static/SMS)
// are satisfied by submitting `{ code }`; a passkey/security key (`webauthn`) is
// satisfied by running the browser WebAuthn API over the challenge's options and
// submitting the resulting assertion as `{ webauthn }`. `selectedDevice` is the
// one the user is proving — auto-picked when there's only one, otherwise chosen
// from a method list.
const deviceChallenges = computed(() => challenge.value?.device_challenges ?? [])
const selectedDevice = ref(null)

// --- Authenticator enrollment (MFA setup) --------------------------------
// TOTP setup (ak-stage-authenticator-totp) hands back a `config_url`
// (otpauth://…) carrying the shared secret; we render it as a QR to scan and pull
// the secret out for manual entry. WebAuthn setup (ak-stage-authenticator-webauthn)
// carries `registration` options we run through the browser's WebAuthn API. Static
// setup (ak-stage-authenticator-static) just lists one-time recovery `codes`.
const totpQr = ref('')
const totpSecret = computed(() => {
  const url = challenge.value?.config_url
  if (!url) {
    return ''
  }
  try {
    return new URL(url).searchParams.get('secret') ?? ''
  } catch {
    return ''
  }
})

const DEVICE_LABELS = {
  webauthn: 'Passkey or security key',
  totp: 'Authenticator app code',
  static: 'Recovery code',
  sms: 'Code sent by SMS',
  email: 'Code sent by email',
  duo: 'Duo push'
}
function deviceLabel(deviceClass) {
  return DEVICE_LABELS[deviceClass] ?? 'Authenticator code'
}

function selectDevice(device) {
  selectedDevice.value = device
  // A passkey/security key has no field to fill — go straight to the WebAuthn
  // ceremony (this click is the user gesture the browser requires) instead of
  // making the user press a second "Use passkey" button.
  if (device.device_class === 'webauthn') {
    submitAuthenticator()
    return
  }
  focusFirstField()
}

const submitLabel = computed(() => {
  if (loading.value) {
    return 'Please wait…'
  }
  if (component.value === 'ak-stage-authenticator-validate' && selectedDevice.value?.device_class === 'webauthn') {
    return 'Use passkey'
  }
  if (component.value === 'ak-stage-authenticator-webauthn') {
    return 'Register device'
  }
  if (component.value === 'ak-stage-authenticator-static') {
    return "I've saved my codes"
  }
  return 'Continue'
})

// --- Passwordless (passkey-first) login ----------------------------------
// When a passwordless flow is configured, authentik's identification challenge
// carries a `passwordless_url` (/if/flow/<slug>/…). We drive that flow's slug
// through the executor ourselves so it renders in this same UI (it opens on a
// webauthn ak-stage-authenticator-validate, handled above). `passwordlessMode`
// tracks that we branched off, so we can offer a way back to email sign-in.
const passwordlessSlug = computed(() => flowSlugFromUrl(challenge.value?.passwordless_url))
const passwordlessMode = ref(false)

function beginPasswordless() {
  const slug = passwordlessSlug.value
  if (!slug) {
    return
  }
  passwordlessMode.value = true
  return beginFlow(slug)
}

// The active stage's <form>, used to focus its first field on every stage change
// (the HTML `autofocus` attribute only fires on initial parse, not on Vue stage
// swaps — e.g. moving to the password step, or "Not you?" returning to email).
const formEl = ref(null)

function focusFirstField() {
  nextTick(() => {
    formEl.value?.querySelector('input:not([type="hidden"]), select, textarea')?.focus()
  })
}

watch(challenge, (c) => {
  for (const key of Object.keys(model)) {
    delete model[key]
  }
  uidError.value = ''
  selectedDevice.value = null
  if (!c) {
    return
  }
  // Seed prompt fields with their initial values.
  if (c.component === 'ak-stage-prompt') {
    for (const field of c.fields ?? []) {
      model[field.field_key] = field.initial_value ?? (field.type === 'checkbox' ? false : '')
    }
  }
  // MFA: with a single enrolled device there's nothing to choose — go straight
  // to proving it (passkey ceremony or code field).
  if (c.component === 'ak-stage-authenticator-validate' && (c.device_challenges ?? []).length === 1) {
    selectedDevice.value = c.device_challenges[0]
    // For a passkey, start WebAuthn immediately (authentik's own UI does this):
    // the click that began this flow is still a valid user gesture. Best-effort —
    // if the browser rejects it, the "Use passkey" button below is the retry.
    if (selectedDevice.value.device_class === 'webauthn') {
      nextTick(() => submitAuthenticator())
    }
  }
  // TOTP enrollment: render the otpauth config_url as a scannable QR code.
  totpQr.value = ''
  if (c.component === 'ak-stage-authenticator-totp' && c.config_url) {
    QRCode.toDataURL(c.config_url, { margin: 1, width: 256 })
      .then((url) => {
        totpQr.value = url
      })
      .catch(() => {
        totpQr.value = ''
      })
  }
  // Back on the identification stage means we're no longer in a passwordless sub-flow.
  if (c.component === 'ak-stage-identification') {
    passwordlessMode.value = false
  }
  focusFirstField()
})

watch(complete, (done) => {
  if (!done) {
    return
  }
  // Provider-initiated flow: hand the browser to authentik's terminal redirect,
  // which continues the OAuth exchange and returns to the third-party app with
  // its code. A standalone login has no such downstream, so the page takes over.
  if (props.resume && redirectTo.value) {
    window.location.assign(redirectTo.value)
    return
  }
  emit('complete', user.value)
})

onMounted(begin)

// Per-field server-side validation errors, keyed by field name.
const fieldErrors = computed(() => challenge.value?.response_errors ?? {})
function errorFor(key) {
  return fieldErrors.value?.[key]?.map((e) => e.string).join(' ')
}

// Client-side warning for the identification field, cleared as the user types
// and whenever the stage changes (see the challenge watcher above).
const uidError = ref('')

function validateIdentification() {
  const value = (model.uid_field ?? '').trim()
  const isEmail = challenge.value?.user_fields?.includes('email')
  if (!value) {
    uidError.value = `Please enter your ${isEmail ? 'email address' : 'username'}.`
    return false
  }
  if (isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    uidError.value = 'Please enter a valid email address.'
    return false
  }
  uidError.value = ''
  return true
}

async function onSubmit() {
  if (component.value === 'ak-stage-identification' && !validateIdentification()) {
    return
  }

  // Authenticator validation branches on device class (passkey vs code), so it
  // builds and submits its own payload.
  if (component.value === 'ak-stage-authenticator-validate') {
    await submitAuthenticator()
    return
  }

  // WebAuthn enrollment: run the browser registration ceremony (the button click
  // is the required user gesture) and submit the attestation.
  if (component.value === 'ak-stage-authenticator-webauthn') {
    await submitWebauthnRegistration()
    return
  }

  const payload = {}
  switch (component.value) {
    case 'ak-stage-identification':
      payload.uid_field = model.uid_field
      if (challenge.value.password_fields) {
        payload.password = model.password
      }
      break
    case 'ak-stage-password':
      payload.password = model.password
      break
    case 'ak-stage-authenticator-totp':
      payload.code = model.code
      break
    case 'ak-stage-authenticator-static':
      // No fields — an empty submit confirms the codes were saved.
      break
    case 'ak-stage-prompt':
      Object.assign(payload, model)
      break
    default:
      Object.assign(payload, model)
  }
  await submit(payload).catch(() => {})
}

// Register a new passkey / security key. Invokes the WebAuthn API with the
// stage's creation options and submits the resulting attestation. Like passkey
// validation, this only completes on the deployed same-origin host (authentik's
// RP ID) — not over http://localhost in dev.
async function submitWebauthnRegistration() {
  error.value = null
  let attestation
  try {
    attestation = await startRegistration({ optionsJSON: challenge.value.registration })
  } catch {
    error.value = 'Passkey registration was cancelled or did not complete. Please try again.'
    return
  }
  await submit({ response: attestation }).catch(() => {})
}

// Prove the selected MFA device. For a passkey we invoke the WebAuthn API with
// the challenge's options (the button click is the required user gesture) and
// submit the assertion; for code devices we submit the typed code. When the
// account has more than one device we also echo `selected_challenge` so authentik
// validates against the class the user picked. NOTE: a passkey is bound to
// authentik's RP ID, so navigator.credentials.get() only succeeds on the deployed
// same-origin host — it cannot complete over http://localhost in dev.
async function submitAuthenticator() {
  const device = selectedDevice.value
  if (!device) {
    return
  }
  // Disambiguate only when needed — keeps the single-device payload minimal.
  const selection = deviceChallenges.value.length > 1 ? { selected_challenge: device } : {}

  if (device.device_class === 'webauthn') {
    error.value = null
    let assertion
    try {
      assertion = await startAuthentication({ optionsJSON: device.challenge })
    } catch {
      // User dismissed the prompt or no matching credential was available.
      error.value = 'Passkey verification was cancelled or did not complete. Please try again.'
      return
    }
    await submit({ ...selection, webauthn: assertion }).catch(() => {})
    return
  }

  await submit({ ...selection, code: model.code }).catch(() => {})
}

// Map authentik prompt field types onto native input types.
function inputType(field) {
  return { text: 'text', username: 'text', email: 'email', password: 'password', number: 'number', date: 'date', tel: 'tel', url: 'url' }[field.type] ?? 'text'
}

// Social / source logins can't be driven headlessly like password stages: the
// browser has to leave to authentik (and on to Google/GitHub/Apple) and come
// back. We send it to the source's login URL with a `next` that returns to this
// same page carrying `?social=return`, which login.vue picks up to finalize the
// session. `source.url` is the absolute endpoint withSources() resolved for us.
function continueWithSource(source) {
  if (!source.url) {
    return
  }
  const back = new URL(window.location.href)
  back.hash = ''
  back.search = ''
  back.searchParams.set('social', 'return')
  const url = new URL(source.url)
  url.searchParams.set('next', back.toString())
  window.location.href = url.toString()
}

// --- Session end (provider invalidation) ---------------------------------
// ak-stage-session-end is the terminal-but-interactive "you've been signed out
// of <app>" screen an app's invalidation flow ends on. Unlike other stages we
// never POST back to the executor — each option is a navigation:
//   returnToApplications — stay signed into IETF Account, back to our app list
//     (client-side; the default provider invalidation flow does NOT end the
//     authentik session, so the user is still authenticated).
//   backToApplication — full-page to the app's launch URL, re-entering it.
//   signOutEntirely — to our in-app sign-out page, which drives the brand's
//     default invalidation flow (the real logout) in this UI rather than sending
//     the browser to authentik's native flow view. authentik's own
//     invalidation_flow_url points at that same flow; /signed-out drives our
//     configured `invalidation` slug (the two are the same flow by config).
function returnToApplications() {
  return navigateTo('/account/applications')
}
function backToApplication() {
  const url = challenge.value?.application_launch_url
  if (url) {
    window.location.assign(url)
  }
}
function signOutEntirely() {
  return navigateTo('/signed-out')
}
</script>

<template>
  <div :class="{ card: !embedded }">
    <template v-if="!embedded">
      <h1 class="mb-1 text-xl font-semibold text-slate-900">
        {{ title || challenge?.flow_info?.title || 'Authentik' }}
      </h1>
      <p v-if="challenge?.pending_user" class="mb-6 text-sm text-slate-500">
        Continue as {{ challenge.pending_user }}
        <button type="button" class="link" :disabled="loading" @click="begin">(Not you?)</button>
      </p>
      <div v-else class="mb-6" />
    </template>

    <!-- Global (non-field) errors -->
    <div v-if="error" class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ error }}
    </div>
    <div
      v-for="msg in challenge?.response_errors?.non_field_errors"
      :key="msg.code"
      class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
    >
      {{ msg.string }}
    </div>

    <!-- Flow complete -->
    <div v-if="complete" class="text-sm text-slate-600">
      <slot name="complete">You're all set.</slot>
    </div>

    <!-- Initial load -->
    <div v-else-if="!challenge" class="flex flex-col items-center gap-3 py-6 text-sm text-slate-400">
      <span
        class="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500"
        role="status"
        aria-label="Loading"
      />
      <span>Loading…</span>
    </div>

    <!-- Active stage -->
    <form
      v-else
      ref="formEl"
      @submit.prevent="onSubmit"
      :class="component === 'ak-stage-identification' ? 'space-y-2' : 'space-y-4'"
    >
      <!-- Identification: username/email (+ optional inline password) -->
      <template v-if="component === 'ak-stage-identification'">
        <div>
          <label class="field-label">{{ challenge.user_fields?.includes('email') ? 'Email' : 'Username' }}</label>
          <input
            v-model="model.uid_field"
            class="field-input"
            autocomplete="username"
            autofocus
            @input="uidError = ''"
          />
          <p v-if="uidError || errorFor('uid_field')" class="mt-1 text-sm text-red-600">
            {{ uidError || errorFor('uid_field') }}
          </p>
        </div>
        <div v-if="challenge.password_fields">
          <label class="field-label">Password</label>
          <input v-model="model.password" type="password" class="field-input" autocomplete="current-password" />
          <p v-if="errorFor('password')" class="mt-1 text-sm text-red-600">{{ errorFor('password') }}</p>
        </div>
      </template>

      <!-- Dedicated password stage -->
      <template v-else-if="component === 'ak-stage-password'">
        <div>
          <label class="field-label">Password</label>
          <input v-model="model.password" type="password" class="field-input" autocomplete="current-password" />
          <p v-if="errorFor('password')" class="mt-1 text-sm text-red-600">{{ errorFor('password') }}</p>
        </div>
      </template>

      <!-- MFA / authenticator validation. authentik offers one challenge per
           enrolled device; pick a method (when there's more than one), then prove
           it with a passkey or a code. -->
      <template v-else-if="component === 'ak-stage-authenticator-validate'">
        <!-- Method chooser (multiple devices enrolled) -->
        <div v-if="!selectedDevice" class="space-y-2">
          <p class="text-sm text-slate-600">Choose how to verify your identity:</p>
          <button
            v-for="device in deviceChallenges"
            :key="device.device_uid || device.device_class"
            type="button"
            class="btn-social w-full justify-center"
            :disabled="loading"
            @click="selectDevice(device)"
          >
            {{ deviceLabel(device.device_class) }}
          </button>
        </div>

        <!-- Passkey / security key: no field, the button below runs WebAuthn -->
        <template v-else-if="selectedDevice.device_class === 'webauthn'">
          <p class="text-sm text-slate-600">
            Use your passkey or security key to finish signing in.
          </p>
        </template>

        <!-- Code-based device (TOTP / static / SMS / email) -->
        <template v-else>
          <div>
            <label class="field-label">{{ deviceLabel(selectedDevice.device_class) }}</label>
            <input v-model="model.code" inputmode="numeric" class="field-input" autocomplete="one-time-code" autofocus />
            <p v-if="errorFor('code')" class="mt-1 text-sm text-red-600">{{ errorFor('code') }}</p>
          </div>
        </template>

        <button
          v-if="selectedDevice && deviceChallenges.length > 1"
          type="button"
          class="link text-sm"
          :disabled="loading"
          @click="selectedDevice = null"
        >
          Use a different method
        </button>
        <button
          v-if="passwordlessMode"
          type="button"
          class="link block text-sm"
          :disabled="loading"
          @click="begin"
        >
          Back to email sign-in
        </button>
      </template>

      <!-- Dynamic prompt stage (enrollment, extra fields, password set, ...) -->
      <template v-else-if="component === 'ak-stage-prompt'">
        <div v-for="field in challenge.fields" :key="field.field_key">
          <template v-if="field.type === 'static' || field.type === 'hidden'">
            <p v-if="field.type === 'static'" class="text-sm text-slate-600" v-html="field.initial_value" />
          </template>
          <template v-else-if="field.type === 'checkbox'">
            <label class="flex items-center gap-2 text-sm text-slate-700">
              <input v-model="model[field.field_key]" type="checkbox" class="rounded border-slate-300" />
              <span v-html="field.label" />
            </label>
          </template>
          <template v-else-if="field.type === 'dropdown'">
            <label class="field-label">{{ field.label }}</label>
            <select v-model="model[field.field_key]" class="field-input">
              <option v-for="choice in field.choices" :key="choice" :value="choice">{{ choice }}</option>
            </select>
          </template>
          <template v-else-if="field.type === 'text_area'">
            <label class="field-label">{{ field.label }}</label>
            <textarea v-model="model[field.field_key]" class="field-input" rows="3" :placeholder="field.placeholder" />
          </template>
          <template v-else>
            <label class="field-label">{{ field.label }}</label>
            <input
              v-model="model[field.field_key]"
              :type="inputType(field)"
              :placeholder="field.placeholder"
              :required="field.required"
              class="field-input"
            />
          </template>
          <p v-if="errorFor(field.field_key)" class="mt-1 text-sm text-red-600">{{ errorFor(field.field_key) }}</p>
        </div>
      </template>

      <!-- OAuth consent (explicit-consent providers): confirm access. Submitting
           the empty form advances the flow, which redirects back to the app. -->
      <template v-else-if="component === 'ak-stage-consent'">
        <p class="text-sm text-slate-600">
          <span class="font-medium">{{ challenge.flow_info?.title || 'An application' }}</span>
          is requesting access to your IETF account.
        </p>
        <ul
          v-if="challenge.permissions?.length"
          class="list-disc space-y-1 pl-5 text-sm text-slate-600"
        >
          <li v-for="perm in challenge.permissions" :key="perm.id">{{ perm.name }}</li>
        </ul>
      </template>

      <!-- TOTP enrollment: scan the QR (or enter the secret), then confirm a code -->
      <template v-else-if="component === 'ak-stage-authenticator-totp'">
        <p class="text-sm text-slate-600">
          Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.
        </p>
        <div class="flex justify-center">
          <img
            v-if="totpQr"
            :src="totpQr"
            alt="Authenticator setup QR code"
            class="h-44 w-44 rounded-lg border border-slate-200"
          />
        </div>
        <p v-if="totpSecret" class="text-center text-xs text-slate-500">
          Can't scan? Enter this key manually:<br />
          <code class="break-all font-mono text-slate-700">{{ totpSecret }}</code>
        </p>
        <div>
          <label class="field-label">Verification code</label>
          <input
            v-model="model.code"
            inputmode="numeric"
            class="field-input"
            autocomplete="one-time-code"
            autofocus
          />
          <p v-if="errorFor('code')" class="mt-1 text-sm text-red-600">{{ errorFor('code') }}</p>
        </div>
      </template>

      <!-- Passkey / security key enrollment: the submit button runs WebAuthn -->
      <template v-else-if="component === 'ak-stage-authenticator-webauthn'">
        <p class="text-sm text-slate-600">
          Register a passkey or security key. Select the button below and follow your browser's prompts.
        </p>
      </template>

      <!-- Static recovery codes: show them, submitting confirms they're saved -->
      <template v-else-if="component === 'ak-stage-authenticator-static'">
        <p class="text-sm text-slate-600">
          Save these recovery codes somewhere safe. Each one can be used once if you lose access to
          your other methods.
        </p>
        <ul
          class="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3
            text-center font-mono text-sm text-slate-700"
        >
          <li v-for="code in challenge.codes" :key="code">{{ code }}</li>
        </ul>
      </template>

      <!-- Email stage (e.g. recovery link sent) -->
      <template v-else-if="component === 'ak-stage-email'">
        <p class="text-sm text-slate-600">
          Check your inbox — we've sent you an email to continue.
        </p>
      </template>

      <!-- Access denied: a terminal stage explaining why the flow can't continue
           (e.g. no allowed MFA authenticator). No submit — the header's "Not you?"
           is the way back. -->
      <template v-else-if="component === 'ak-stage-access-denied'">
        <div class="flex flex-col items-center gap-3 py-4 text-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" class="h-20 w-20 text-red-500" aria-hidden="true">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
            />
          </svg>
          <p class="text-sm text-red-700">{{ challenge.error_message || 'Access denied.' }}</p>
        </div>
      </template>

      <!-- Session end: the "you've been signed out of <app>" screen an app's
           provider invalidation flow ends on. No submit — each option navigates
           (see returnToApplications / backToApplication / signOutEntirely). -->
      <template v-else-if="component === 'ak-stage-session-end'">
        <div class="space-y-4">
          <p class="text-sm text-slate-600">
            You've been signed out of
            <span class="font-medium">{{ challenge.application_name || 'the application' }}</span>.
            What would you like to do next?
          </p>
          <button
            v-if="challenge.application_launch_url"
            type="button"
            class="btn-primary"
            @click="backToApplication"
          >
            Sign back into {{ challenge.application_name || 'the application' }}
          </button>
          <button type="button" class="btn-social w-full justify-center" @click="returnToApplications">
            Return to your applications
          </button>
          <button
            v-if="challenge.invalidation_flow_url"
            type="button"
            class="btn-social w-full justify-center text-red-600"
            @click="signOutEntirely"
          >
            Sign out of IETF Account entirely
          </button>
        </div>
      </template>

      <!-- Anything we haven't styled yet: surface it so it's never a dead end. -->
      <template v-else>
        <p class="text-sm text-slate-600">
          Unsupported stage <code>{{ component }}</code>. Add a branch in FlowExecutor.vue.
        </p>
        <pre class="overflow-x-auto rounded-lg bg-slate-100 p-3 text-xs">{{ challenge }}</pre>
      </template>

      <button
        v-if="component !== 'ak-stage-email' && component !== 'ak-stage-access-denied' && component !== 'ak-stage-session-end' && !(component === 'ak-stage-authenticator-validate' && !selectedDevice)"
        type="submit"
        class="btn-primary"
        :disabled="loading"
      >
        {{ submitLabel }}
      </button>
    </form>

    <!-- Passwordless: sign in with a passkey. authentik exposes passwordless_url on
         the identification challenge when a passwordless flow is configured; we
         drive that flow's slug through the executor so it stays in this UI. -->
    <div v-if="component === 'ak-stage-identification' && passwordlessSlug && !resume" class="mt-4">
      <button
        type="button"
        class="btn-social w-full justify-center"
        :disabled="loading"
        @click="beginPasswordless"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="h-5 w-5 shrink-0" aria-hidden="true">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004.5 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 01-3.6 9.75m6.633-4.596a18.666 18.666 0 01-2.485 5.33"
          />
        </svg>
        <span>Sign in with a passkey</span>
      </button>
    </div>

    <!-- Social / federated logins (authentik sources on the identification stage) -->
    <div
      v-if="component === 'ak-stage-identification' && challenge?.sources?.length"
      class="mt-6"
    >
      <div class="relative">
        <div class="absolute inset-0 flex items-center" aria-hidden="true">
          <div class="w-full border-t border-slate-200" />
        </div>
        <div class="relative flex justify-center">
          <span class="bg-white px-2 text-xs uppercase tracking-wide text-slate-400">
            or continue with
          </span>
        </div>
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        <button
          v-for="source in challenge.sources"
          :key="source.name"
          type="button"
          class="btn-social"
          :disabled="loading"
          @click="continueWithSource(source)"
        >
          <img v-if="source.icon_url" :src="source.icon_url" :alt="`${source.name} logo`" class="h-5 w-5" />
          <span>{{ source.name }}</span>
        </button>
      </div>
    </div>

    <!-- App-specific alternative sign-in paths (e.g. legacy migration), shown on
         the first/identification stage alongside the social buttons. -->
    <div v-if="$slots.alternatives && component === 'ak-stage-identification'" class="mt-6">
      <slot name="alternatives" />
    </div>

    <div class="mt-6 text-center text-sm text-slate-500">
      <slot name="footer" :component="component" />
    </div>
  </div>
</template>
