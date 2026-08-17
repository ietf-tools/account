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
  // Per-stage heading overrides, keyed by challenge `component`. `title` names the
  // flow as a whole; a stage that changes the subject can own the heading instead —
  // enrollment's closing "check your inbox" step is about verifying an email, not
  // "Create your account", while the same stage under the recovery flow is still
  // about resetting a password. Hence per host, not a constant in here.
  stageTitles: { type: Object, default: () => ({}) },
  // Set when a third-party app initiated this flow (see login.vue): resume
  // authentik's existing plan instead of restarting, and on completion follow
  // its redirect back to the app rather than emitting `complete`.
  resume: { type: Boolean, default: false },
  // Drop the card chrome (outer card, title, "continue as") so the flow can be
  // hosted inside another panel — e.g. MFA enrollment in the account shell.
  embedded: { type: Boolean, default: false },
  // Whether to show the "Continue as <pending_user> (Not you?)" line under the
  // heading. Off for a flow the user didn't start from a sign-in form — the email
  // confirmation link, say, where there is nobody else it could be and restarting is
  // not on offer.
  showPendingUser: { type: Boolean, default: true },
  // In resume mode, whether to follow authentik's terminal redirect (its `to`) on
  // completion. True for provider-continuation flows (OAuth login/logout, social
  // return) where that redirect IS the point — it hands the browser back to the
  // downstream app. False for a standalone resume like the enrollment email
  // confirmation, whose `to` only points into authentik's own user UI: there we
  // emit `complete` instead so the host page resolves the session and routes.
  followRedirect: { type: Boolean, default: true },
  // Auto-submit a leading ak-stage-consent instead of rendering its "confirm to
  // proceed" button (see reset-password.vue). Use only where that consent is a
  // redundant gate — i.e. a genuinely interactive stage follows it (the password
  // prompt), which is what actually guards the flow. MUST stay opt-in: real OAuth
  // access-consent on login has to be an explicit user action, never auto-clicked.
  autoConsent: { type: Boolean, default: false }
})
// `stage` reports the current challenge's component (null before the first one
// lands). Embedded hosts render their own chrome, so they need to follow the flow to
// keep a heading or footer link in step with the stage on screen.
const emit = defineEmits(['complete', 'stage'])

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
watch(component, (value) => emit('stage', value ?? null))

// True while a host-opted-in consent stage is being auto-submitted (see the
// autoConsent prop): the template shows the loading spinner rather than the consent
// card, so the redundant step is skipped without a flash.
const autoConsenting = computed(() => props.autoConsent && component.value === 'ak-stage-consent')

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

// One glyph per device class for the method buttons, reusing what the account MFA
// view shows for the same types (phone / fingerprint / codes — see
// pages/account/mfa.vue). Heroicons outline paths; a class we don't know falls back
// to the shield that view uses for an enrolled authenticator.
const DEVICE_ICONS = {
  totp: 'M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3',
  webauthn: 'M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004.5 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 01-3.6 9.75m6.633-4.596a18.666 18.666 0 01-2.485 5.33',
  static: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
  sms: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z',
  email: 'M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75'
}
const FALLBACK_DEVICE_ICON =
  'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.249-8.25-3.286z'

function deviceIcon(deviceClass) {
  return DEVICE_ICONS[deviceClass] ?? FALLBACK_DEVICE_ICON
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

// --- Captcha -------------------------------------------------------------
// ak-stage-captcha (Cloudflare Turnstile on the enrollment flow) is satisfied by
// POSTing the solved `{ token }`; CaptchaStage.vue owns loading the provider
// script and rendering the widget, and hands the token up as soon as it has one.
// There's nothing to confirm afterwards, so the stage submits itself rather than
// rendering a Continue button (this is what authentik's own flow UI does too).
//
// The attempt counter guards against a rejected-token loop: Turnstile's managed
// widget usually clears without any interaction, so if authentik keeps refusing
// the token (a mis-set secret key, say) the widget would happily re-solve and
// re-submit forever. After a few tries we stop and let the user retry manually.
const CAPTCHA_MAX_ATTEMPTS = 3
const captchaAttempts = ref(0)
const captchaError = ref('')

function submitCaptcha(token) {
  captchaAttempts.value += 1
  if (captchaAttempts.value > CAPTCHA_MAX_ATTEMPTS) {
    captchaError.value = "We couldn't verify that you're human. Please try again."
    return
  }
  return submit({ token }).catch(() => {})
}

function retryCaptcha() {
  captchaAttempts.value = 0
  captchaError.value = ''
}

// --- "Stay signed in" (ak-stage-user-login) -------------------------------
// authentik's user login stage normally runs headlessly, but when the stage's
// `remember_me_offset` is non-zero it emits a challenge and REQUIRES a
// `remember_me` boolean back (the session then lasts session_duration + offset).
// It arrives at the very end of the flow, after password/MFA, so a checkbox on
// the sign-in form can't ride along with it — we hold the answer and reply for
// the user. Where we never got to ask (social return, enrollment, recovery: no
// password stage) the stage renders as a visible card instead, so the choice is
// always the user's rather than a silent default.
//
// Ticked by default: password managers autofill *and submit*, so an unticked box is
// often never seen, and staying signed in is what almost everyone wants. Unticking
// it is one click for the people on a shared machine.
const rememberMe = ref(true)
const rememberMeAsked = ref(false)
const rememberMeSubmitted = ref(false)

// True while a pre-answered stage is in flight: the template shows the spinner
// rather than the card, so the skipped step never flashes.
const autoRemembering = computed(() => {
  return component.value === 'ak-stage-user-login' && rememberMeAsked.value
})

function submitRememberMe(value) {
  rememberMe.value = value
  return submit({ remember_me: value }).catch(() => {})
}

// The visible stay-signed-in card asks its own question, so it carries its own
// heading and drops the "Continue as …" line — the host page's title and the
// pending user belong to the sign-in step that is already behind us. Not while
// autoRemembering: that's the spinner path, where the header stays as it was.
const askingRememberMe = computed(() => {
  return component.value === 'ak-stage-user-login' && !autoRemembering.value
})

// The card's heading: the stay-signed-in card's own question, else the host's
// per-stage override, else the flow-wide title (authentik's flow title as a last
// resort). Not applied while autoRemembering — that's the spinner path, where the
// heading stays as it was.
const heading = computed(() => {
  if (askingRememberMe.value) {
    return 'Stay signed in?'
  }
  return props.stageTitles[component.value] || props.title || challenge.value?.flow_info?.title || 'Authentik'
})

// Stages that render their own actions, or have none at all: no generic Continue
// button (see the template's submit button).
const NO_SUBMIT_STAGES = new Set([
  'ak-stage-email',
  'ak-stage-access-denied',
  'ak-stage-session-end',
  'ak-stage-captcha',
  'ak-stage-user-login'
])
const showSubmit = computed(() => {
  if (NO_SUBMIT_STAGES.has(component.value)) {
    return false
  }
  // MFA method chooser: the method buttons are the action.
  return !(component.value === 'ak-stage-authenticator-validate' && !selectedDevice.value)
})

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

// Guards the one-shot auto-consent (see the `autoConsent` prop): flips once we've
// fired the programmatic submit so a re-render (e.g. the consent stage coming back
// with an error) can't loop.
const autoConsentTried = ref(false)

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

// The ak-stage-autosubmit <form> (see the challenge watcher / template). Held
// separately from formEl because it's a real cross-origin POST that must navigate
// natively — it is NOT the executor form and never runs onSubmit.
const autosubmitEl = ref(null)

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
  for (const key of Object.keys(promptErrors)) {
    delete promptErrors[key]
  }
  selectedDevice.value = null
  if (!c) {
    return
  }
  // Auto-submit stage: a terminal hand-off to an external endpoint (e.g. a SAML
  // SP's ACS URL — the SAMLResponse rides along as a hidden field). We render a
  // real cross-origin <form> and fire it natively; form.submit() bypasses the
  // @submit handler, so this never posts back to the executor. The visible
  // "Continue" button is the fallback if the browser blocks the automatic submit.
  if (c.component === 'ak-stage-autosubmit') {
    nextTick(() => autosubmitEl.value?.submit())
    return
  }
  // Auto-advance a redundant leading consent stage when the host opts in (recovery:
  // the password prompt that follows is the real interactive gate, so authentik's
  // consent step is just an extra click). One-shot via autoConsentTried so a
  // re-render can't loop. Still pre-fetch-safe: this only runs in a real browser
  // executing JS — a link pre-fetch never gets this far.
  if (props.autoConsent && c.component === 'ak-stage-consent' && !autoConsentTried.value) {
    autoConsentTried.value = true
    nextTick(onSubmit)
    return
  }
  // The password stage hosts the "keep me signed in" checkbox, which pre-answers
  // the user login stage at the end of the flow (see submitRememberMe).
  if (c.component === 'ak-stage-password' && props.kind === 'authentication') {
    rememberMeAsked.value = true
  }
  // Pre-answered "stay signed in" — don't make the user answer twice. If that
  // silent answer comes back rejected the same stage re-renders, so fall through
  // to the visible card rather than re-submitting forever (or spinning on
  // autoRemembering).
  if (c.component === 'ak-stage-user-login' && rememberMeAsked.value) {
    if (rememberMeSubmitted.value) {
      rememberMeAsked.value = false
    } else {
      rememberMeSubmitted.value = true
      nextTick(() => submitRememberMe(rememberMe.value))
      return
    }
  }
  // Seed prompt fields with their initial values.
  if (c.component === 'ak-stage-prompt') {
    for (const field of c.fields ?? []) {
      if (field.type === 'checkbox') {
        // authentik serializes every initial_value as a string, so a checkbox
        // arrives as '' / 'true' / anything — its own flow UI treats non-empty as
        // checked. Coerce, or we'd POST '' where authentik wants a boolean.
        model[field.field_key] = Boolean(field.initial_value) && field.initial_value !== 'false'
        continue
      }
      model[field.field_key] = field.initial_value ?? ''
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
  // It also means a fresh pass at the flow (a "Not you?" restart), so the
  // stay-signed-in one-shots reset — the user's ticked preference is kept.
  if (c.component === 'ak-stage-identification') {
    passwordlessMode.value = false
    rememberMeAsked.value = false
    rememberMeSubmitted.value = false
  }
  // Leaving the captcha stage clears its retry budget (a stage that comes back
  // with a token error is the same stage, so that case keeps counting).
  if (c.component !== 'ak-stage-captcha') {
    captchaAttempts.value = 0
    captchaError.value = ''
  }
  focusFirstField()
})

watch(complete, (done) => {
  if (!done) {
    return
  }
  // Provider-initiated flow: hand the browser to authentik's terminal redirect,
  // which continues the OAuth exchange and returns to the third-party app with
  // its code. A standalone login (or a resume that opts out via followRedirect)
  // has no such downstream, so the page takes over.
  if (props.resume && props.followRedirect && redirectTo.value) {
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

// --- Prompt stage: required checkboxes ------------------------------------
// Client-side warnings for prompt fields, keyed by field_key (server-side ones
// still come from response_errors). Cleared on stage change and as the user acts.
const promptErrors = reactive({})

function clearPromptError(key) {
  delete promptErrors[key]
}

// Domains no account may be attached to (BLOCKED_EMAIL_DOMAINS). Read once here
// rather than per-keystroke; it's baked into the bundle at build time.
const blockedEmailDomains = useRuntimeConfig().public.blockedEmailDomains ?? []

// A required checkbox has to be TICKED, not merely answered: authentik builds every
// checkbox prompt as a BooleanField with required=False, so `false` is a perfectly
// valid response to it and only a validation policy on the stage rejects one. That
// policy is the real gate (see authentik/ietf-flows/ietf-note-well-consent.yaml —
// the Note Well agreement on both enrollment flows); this just fails it inline
// instead of via a round-trip.
function validatePrompt() {
  let ok = true
  for (const field of challenge.value?.fields ?? []) {
    if (field.type === 'checkbox' && field.required && !model[field.field_key]) {
      promptErrors[field.field_key] = 'Please tick this box to continue.'
      ok = false
    }
    // The sign-up form's email field — the only email prompt either enrollment flow
    // carries (user settings lost its email field to the verified change flow). Same
    // deal as the checkbox above: the gate is a validation policy on the stage in
    // authentik (authentik/ietf-flows/ietf-blocked-email-domains.yaml), which is what
    // catches a social sign-up too since that flow has no field to type into; this
    // just says so inline rather than after a round-trip.
    if (field.type === 'email' || field.field_key === 'email') {
      const blocked = blockedEmailDomain(model[field.field_key], blockedEmailDomains)
      if (blocked) {
        promptErrors[field.field_key] = blockedEmailDomainMessage(blocked)
        ok = false
      }
    }
  }
  return ok
}

// Prompt labels can carry markup — the Note Well agreement links out to ietf.org —
// and are rendered with v-html. Following such a link in place would abandon the
// flow, so force every anchor into a new tab. (Inside the checkbox's <label> the
// links are safe to click: the HTML spec skips label activation for interactive
// descendants, so reading the notice doesn't tick the box.) DOMParser only parses —
// this is the same trust in authentik's copy that the raw v-html already implies.
const richLabels = new Map()
function richLabel(html) {
  const source = html ?? ''
  if (!source.includes('<')) {
    return source
  }
  let parsed = richLabels.get(source)
  if (parsed === undefined) {
    const doc = new DOMParser().parseFromString(source, 'text/html')
    for (const anchor of doc.body.querySelectorAll('a')) {
      anchor.setAttribute('target', '_blank')
      anchor.setAttribute('rel', 'noopener noreferrer')
    }
    parsed = doc.body.innerHTML
    richLabels.set(source, parsed)
  }
  return parsed
}

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

  if (component.value === 'ak-stage-prompt' && !validatePrompt()) {
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
    case 'ak-stage-consent':
      // authentik's consent response requires the challenge's `token` echoed back
      // (timing-safe compared server-side); without it the stage silently
      // re-renders instead of advancing.
      payload.token = challenge.value.token
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

// The prompt field that gets a strength meter: the first password field of a prompt
// stage (a second one is the "repeat" box), on the flows where a password is being
// *chosen* — enrollment and recovery. Never on ak-stage-password, where the user is
// typing one they already have and rating it would be noise.
const strengthKey = computed(() => {
  if (props.kind === 'authentication' || component.value !== 'ak-stage-prompt') {
    return null
  }
  return challenge.value?.fields?.find((field) => field.type === 'password')?.field_key ?? null
})

// Map authentik prompt field types onto native input types.
function inputType(field) {
  return { text: 'text', username: 'text', email: 'email', password: 'password', number: 'number', date: 'date', tel: 'tel', url: 'url' }[field.type] ?? 'text'
}

// Autocomplete hint for a prompt field, so password managers behave sensibly —
// notably `new-password` on the recovery/enrollment password fields, which lets
// them offer to save the freshly chosen password.
function autocompleteFor(field) {
  return { password: 'new-password', email: 'email', username: 'username' }[field.type]
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
      <h1 class="mb-1 text-xl font-semibold text-slate-900">{{ heading }}</h1>
      <p
        v-if="showPendingUser && challenge?.pending_user && !askingRememberMe"
        class="mb-6 text-sm text-slate-500"
      >
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

    <!-- Initial load — also covers the stages we advance on the user's behalf
         (autoConsenting, autoRemembering), so neither skipped card flashes. -->
    <div v-else-if="!challenge || autoConsenting || autoRemembering" class="flex flex-col items-center gap-3 py-6 text-sm text-slate-400">
      <span
        class="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500"
        role="status"
        aria-label="Loading"
      />
      <span>Loading…</span>
    </div>

    <!-- Auto-submit: a terminal stage that hands the browser off to an external
         endpoint via a native form POST (e.g. a SAML SP's ACS URL — the
         SAMLResponse/RelayState ride along as hidden fields). Unlike every other
         stage we do NOT post back to the executor: this is a real cross-origin
         navigation, auto-fired on render (see the challenge watcher). The Continue
         button is the fallback if the browser blocks the automatic submit. -->
    <form
      v-else-if="component === 'ak-stage-autosubmit'"
      ref="autosubmitEl"
      :action="challenge.url"
      method="post"
      class="space-y-4"
    >
      <input
        v-for="(value, key) in challenge.attrs"
        :key="key"
        type="hidden"
        :name="key"
        :value="value"
      />
      <div class="flex flex-col items-center gap-3 py-6 text-sm text-slate-400">
        <span
          class="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500"
          role="status"
          aria-label="Redirecting"
        />
        <span>{{ challenge.title || 'Redirecting…' }}</span>
      </div>
      <button type="submit" class="btn-primary">Continue</button>
    </form>

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
        <!-- Pre-answers the ak-stage-user-login stage at the end of the flow. Only
             on a real sign-in: on a re-auth password prompt (password change) the
             question would be meaningless. -->
        <label v-if="kind === 'authentication'" class="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input v-model="rememberMe" type="checkbox" class="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
          <span>Keep me signed in</span>
        </label>
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
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              class="h-5 w-5 shrink-0 text-slate-400"
              aria-hidden="true"
            >
              <path stroke-linecap="round" stroke-linejoin="round" :d="deviceIcon(device.device_class)" />
            </svg>
            <span>{{ deviceLabel(device.device_class) }}</span>
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
            <p
              v-if="field.type === 'static'"
              class="rich-text text-sm text-slate-600"
              v-html="richLabel(field.initial_value)"
            />
          </template>
          <!-- Checkbox: the label sits beside the box rather than wrapping it, so a
               long one (the Note Well agreement on enrollment) doesn't run under the
               control, and its links stay clickable — see richLabel. -->
          <template v-else-if="field.type === 'checkbox'">
            <div class="flex items-start gap-2.5">
              <input
                :id="`prompt-${field.field_key}`"
                v-model="model[field.field_key]"
                type="checkbox"
                class="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                @change="clearPromptError(field.field_key)"
              />
              <label
                :for="`prompt-${field.field_key}`"
                class="rich-text cursor-pointer text-sm text-slate-700"
                v-html="richLabel(field.label)"
              />
            </div>
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
              :autocomplete="autocompleteFor(field)"
              :placeholder="field.placeholder"
              :required="field.required"
              class="field-input"
              @input="clearPromptError(field.field_key)"
            />
            <PasswordStrength
              v-if="field.field_key === strengthKey"
              :password="model[field.field_key] ?? ''"
            />
          </template>
          <p
            v-if="promptErrors[field.field_key] || errorFor(field.field_key)"
            class="mt-1 text-sm text-red-600"
          >
            {{ promptErrors[field.field_key] || errorFor(field.field_key) }}
          </p>
        </div>
      </template>

      <!-- Consent stage: authentik's generic "confirm to proceed" step, used both for
           OAuth explicit-consent providers and as the enrollment email-link
           confirmation — the wording differs by context, so a host can replace the
           body through the `consent` slot (it gets the challenge, whose `pending_user`
           &c. the copy may want). The fallback below is the OAuth case. Submitting
           echoes back the challenge `token` (see onSubmit) to advance. -->
      <template v-else-if="component === 'ak-stage-consent'">
        <slot name="consent" :challenge="challenge">
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
        </slot>
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

      <!-- Captcha (Cloudflare Turnstile on enrollment). CaptchaStage loads the
           provider script and renders the widget; the solved token is submitted
           as soon as it arrives, so there's no Continue button here. -->
      <template v-else-if="component === 'ak-stage-captcha'">
        <CaptchaStage
          :challenge="challenge"
          :submitting="loading"
          :error-message="captchaError"
          @token="submitCaptcha"
          @retry="retryCaptcha"
        />
        <p v-if="errorFor('token')" class="text-center text-sm text-red-600">
          {{ errorFor('token') }}
        </p>
      </template>

      <!-- Email stage: a link has been sent and the flow now waits on it (enrollment
           verification, recovery reset). Terminal as far as this UI goes — no submit,
           nothing to fill in — so it's the message plus an illustration. -->
      <template v-else-if="component === 'ak-stage-email'">
        <div class="flex flex-col items-center gap-6 text-center">
          <p class="text-sm text-slate-600">
            Check your inbox — we've sent you an email to continue.
          </p>
          <!-- Envelope with a "sent" check badge. The badge is filled white (the card
               is always light) so it reads as sitting on top of the envelope rather
               than the envelope's corner showing through it. -->
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.25"
            class="h-24 w-24 text-slate-300"
            aria-hidden="true"
          >
            <rect x="2.25" y="5.25" width="19.5" height="13.5" rx="2.25" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M3.6 7.1l7.1 5.05a2.25 2.25 0 002.6 0L20.4 7.1" />
            <circle cx="18" cy="17.5" r="5" class="fill-white" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.9 17.6l1.6 1.6 2.6-3.2" />
          </svg>
        </div>
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

      <!-- "Stay signed in?" — authentik's user login stage, which only becomes a
           visible challenge when the stage's remember_me_offset is non-zero. We
           only get here when there was no password stage to host the checkbox
           (social return, enrollment, recovery); a password sign-in answers this
           from the checkbox above and never renders it. -->
      <template v-else-if="component === 'ak-stage-user-login'">
        <p class="text-sm text-slate-600">
          Stay signed in on this device? Choose No on a shared or public computer.
        </p>
        <div class="flex gap-2">
          <button
            type="button"
            class="btn-primary flex-1"
            :disabled="loading"
            @click="submitRememberMe(true)"
          >
            Yes, keep me signed in
          </button>
          <button
            type="button"
            class="btn-social flex-1 justify-center"
            :disabled="loading"
            @click="submitRememberMe(false)"
          >
            No
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
        v-if="showSubmit"
        type="submit"
        class="btn-primary"
        :disabled="loading"
      >
        {{ submitLabel }}
      </button>
    </form>

    <!-- Ways out of a password the user can't produce, shown directly under the
         password form: someone stuck at this stage needs them here, not in the
         small print at the foot of the card. Host-provided (see login.vue), so the
         generic executor stays free of app-specific routes. -->
    <div v-if="$slots.recovery && component === 'ak-stage-password'" class="mt-6">
      <!-- `challenge` rides along so the host can carry who we're signing in as
           (challenge.pending_user) into a recovery route. -->
      <slot name="recovery" :challenge="challenge" />
    </div>

    <!-- Passwordless: sign in with a passkey. authentik exposes passwordless_url on
         the identification challenge when a passwordless flow is configured; we
         drive that flow's slug through the executor so it stays in this UI. -->
    <div v-if="component === 'ak-stage-identification' && passwordlessSlug && !resume" class="mt-4">
      <!-- Same labelled rule as the social block below, so the two alternatives to
           the Continue button read as a set. -->
      <div class="relative">
        <div class="absolute inset-0 flex items-center" aria-hidden="true">
          <div class="w-full border-t border-slate-200" />
        </div>
        <div class="relative flex justify-center">
          <span class="bg-white px-2 text-xs uppercase tracking-wide text-slate-400">or</span>
        </div>
      </div>
      <button
        type="button"
        class="btn-social mt-4 w-full justify-center"
        :disabled="loading"
        @click="beginPasswordless"
      >
        <!-- Same fingerprint glyph the webauthn method button uses. -->
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="h-5 w-5 shrink-0" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" :d="DEVICE_ICONS.webauthn" />
        </svg>
        <span>Sign in with a passkey</span>
      </button>
    </div>

    <!-- Social / federated logins (authentik sources on the identification stage) -->
    <div
      v-if="component === 'ak-stage-identification' && challenge?.sources?.length"
      class="mt-4"
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
    <div v-if="$slots.alternatives && component === 'ak-stage-identification'" class="mt-4">
      <slot name="alternatives" />
    </div>

    <div class="mt-6 text-center text-sm text-slate-500">
      <!-- `challenge` rides along with `component` so a host can tell two stages of
           the same component apart — e.g. enrollment's sign-up form and its Note Well
           agreement are both ak-stage-prompt (see register.vue). -->
      <slot name="footer" :component="component" :challenge="challenge" />
    </div>
  </div>
</template>
