<script>
// Module scope: shared by every mount of this component.

// One <script> tag per provider URL for the page's lifetime. A captcha stage can
// render more than once (a rejected token comes back as the same stage, and the
// widget is re-created each time), but the provider scripts install a global and
// are not safe to evaluate twice.
const scriptLoads = new Map()

function loadScript(url) {
  let load = scriptLoads.get(url)
  if (!load) {
    load = new Promise((resolve, reject) => {
      const el = document.createElement('script')
      el.src = url
      el.async = true
      el.addEventListener('load', () => resolve())
      el.addEventListener('error', () => {
        // Drop the cached rejection so "Try again" can re-add the tag — a blocked
        // or flaky CDN fetch is the common failure here.
        scriptLoads.delete(url)
        el.remove()
        reject(new Error('The security check could not be loaded.'))
      })
      document.head.append(el)
    })
    scriptLoads.set(url, load)
  }
  return load
}

// The provider globals we know how to drive, in the order authentik's own flow UI
// probes them. All three expose the same explicit-render surface
// (`render(container, options) -> widgetId`, plus `reset`/`remove`/`execute`),
// which is the only thing this component relies on.
const PROVIDER_GLOBALS = ['turnstile', 'hcaptcha', 'grecaptcha']

// A script `load` event doesn't mean the global is installed — each provider
// bootstraps itself asynchronously — so poll briefly for whichever one appears.
async function waitForProvider(timeout = 10000) {
  const deadline = Date.now() + timeout
  for (;;) {
    const name = PROVIDER_GLOBALS.find((key) => typeof window[key]?.render === 'function')
    if (name) {
      return { name, api: window[name] }
    }
    if (Date.now() > deadline) {
      throw new Error('The security check did not load. Please try again.')
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
</script>

<script setup>
// Renders an authentik `ak-stage-captcha` challenge.
//
// authentik does not solve the captcha itself: the challenge carries the
// provider's script URL (`js_url`) and public `site_key`, and the stage is
// satisfied by POSTing the solved `{ token }` back to the executor. The token is
// emitted the moment the widget produces one — there is nothing for the user to
// confirm afterwards — so FlowExecutor renders no Continue button for this stage.
//
// The IETF enrollment flow uses Cloudflare Turnstile; reCAPTCHA and hCaptcha
// (authentik's other providers) speak the same explicit-render API, so they work
// here too. `interactive: false` means the provider is expected to clear the
// visitor silently: the widget still mounts, it just has nothing to show.
const props = defineProps({
  challenge: { type: Object, required: true },
  // True while the parent is POSTing the token, so the status line can say so.
  submitting: { type: Boolean, default: false },
  // A parent-side failure shown in place of the widget (e.g. authentik kept
  // rejecting tokens — see FlowExecutor's submitCaptcha). "Try again" clears it.
  errorMessage: { type: String, default: '' }
})
const emit = defineEmits(['token', 'retry'])

const containerEl = ref(null)
const state = ref('loading') // loading | ready | solved | failed
const failure = ref('')
const interactive = computed(() => props.challenge?.interactive !== false)

let provider = null
let widgetId = null
// Bumps on every (re)render. Provider callbacks fire into their own closures and
// keep doing so after we've torn a widget down, so each one checks the generation
// it was created in before touching state.
let generation = 0

function teardown() {
  if (provider && widgetId !== null && typeof provider.api.remove === 'function') {
    try {
      provider.api.remove(widgetId)
    } catch {
      // Already gone (grecaptcha has no remove at all) — clearing the container
      // below is enough.
    }
  }
  widgetId = null
  if (containerEl.value) {
    containerEl.value.innerHTML = ''
  }
}

function fail(message) {
  state.value = 'failed'
  failure.value = message
}

function widgetOptions(run) {
  const options = {
    sitekey: props.challenge.site_key,
    // The card is always light, so pin the widget rather than let it follow the
    // visitor's OS dark mode and render dark-on-white.
    theme: 'light',
    callback: (token) => {
      if (run !== generation) {
        return
      }
      state.value = 'solved'
      emit('token', token)
    },
    'expired-callback': () => {
      if (run !== generation) {
        return
      }
      // Tokens are single-use and short-lived; get a fresh one rather than let a
      // stale one be submitted.
      provider.api.reset?.(widgetId)
      state.value = 'ready'
    },
    'error-callback': () => {
      if (run !== generation) {
        return
      }
      fail('The security check could not be completed. Please try again.')
    }
  }
  if (!interactive.value) {
    // Turnstile decides for itself whether to show anything; the others need to
    // be told they're the invisible variant.
    Object.assign(
      options,
      provider.name === 'turnstile' ? { appearance: 'interaction-only' } : { size: 'invisible' }
    )
  }
  return options
}

async function start() {
  const run = ++generation
  teardown()
  state.value = 'loading'
  failure.value = ''

  try {
    await loadScript(props.challenge.js_url)
    provider = await waitForProvider()
  } catch (e) {
    if (run === generation) {
      fail(e.message)
    }
    return
  }
  // The stage moved on (or unmounted) while the script was loading.
  if (run !== generation || !containerEl.value) {
    return
  }

  try {
    widgetId = provider.api.render(containerEl.value, widgetOptions(run))
  } catch {
    fail('The security check could not be displayed. Please try again.')
    return
  }
  state.value = 'ready'

  // An invisible reCAPTCHA/hCaptcha widget sits idle until executed; Turnstile
  // starts on render.
  if (!interactive.value && provider.name !== 'turnstile') {
    provider.api.execute?.(widgetId)
  }
}

function retry() {
  emit('retry')
  start()
}

onMounted(start)
// A rejected token brings the same stage back as a new challenge object: rebuild
// the widget, since its token has been spent.
watch(() => props.challenge, start)
onBeforeUnmount(() => {
  generation += 1
  teardown()
})

const failureText = computed(() => props.errorMessage || failure.value)
const busy = computed(() => state.value === 'loading' || state.value === 'solved' || props.submitting)
const statusText = computed(() => {
  if (failureText.value) {
    return ''
  }
  if (state.value === 'solved' || props.submitting) {
    return 'Verifying…'
  }
  if (state.value === 'loading') {
    return 'Loading security check…'
  }
  return interactive.value ? "Confirm you're human to continue." : 'Checking your browser…'
})
</script>

<template>
  <div class="space-y-3">
    <div v-if="statusText" class="flex items-center justify-center gap-2 text-sm text-slate-500">
      <span
        v-if="busy"
        class="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500"
        role="status"
        aria-label="Loading"
      />
      <span>{{ statusText }}</span>
    </div>

    <!-- The provider renders its widget in here. Left in the layout even when the
         stage is non-interactive: the widget collapses to nothing on its own, and
         hiding it can stop the provider from running at all. -->
    <div v-show="!failureText" ref="containerEl" class="flex justify-center" />

    <div v-if="failureText" class="space-y-3">
      <p class="text-sm text-red-600">{{ failureText }}</p>
      <button type="button" class="btn-social w-full justify-center" @click="retry">
        Try again
      </button>
    </div>
  </div>
</template>
