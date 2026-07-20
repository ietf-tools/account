<script setup>
// The signed-in user's API tokens: list, create, copy the secret, delete.
// Data + actions come from useTokens() (authentik's /core/tokens/).
definePageMeta({ middleware: 'auth', layout: 'account' })

const { tokens, loading, error, usingSample, load, create, remove, viewKey } = useTokens()
const auth = useAuthStore()

// Help panel: how to turn an app password into an access token an app will accept.
const showHelp = ref(false)

// authentik's OAuth2 token endpoint lives at the domain root (same origin as
// /api/v3), not under the app's /app/ base. Resolved on mount so the example is
// concrete; falls back to the production host before hydration.
const authOrigin = ref('https://account.ietf.org')

// Prefill the user's username in the example; client_id / password stay as
// placeholders the user fills in.
const exampleUsername = computed(() => auth.user?.username || '<your-username>')

const exampleCommand = computed(
  () => `# 1. Exchange the app password for a short-lived access token
curl -X POST ${authOrigin.value}/application/o/token/ \\
  -d grant_type=client_credentials \\
  -d client_id=<app-client-id> \\
  -d username=${exampleUsername.value} \\
  -d password=<your-app-password> \\
  -d scope="openid profile email"

# 2. Call the app's API with the returned access_token
curl https://datatracker.ietf.org/api/... \\
  -H "Authorization: Bearer <access_token>"`
)

// Default expiry for new tokens: 30 days out, as a YYYY-MM-DD value for the date
// input.
function defaultExpiry() {
  const date = new Date()
  date.setDate(date.getDate() + 30)
  return date.toISOString().slice(0, 10)
}

// Create form. Tokens expire by default and are app passwords by default (the
// app-facing use case: exchange for an OAuth2 access token against apps like
// Datatracker). 'api' tokens instead authenticate to authentik's own API.
const showCreate = ref(false)
const form = reactive({
  identifier: '',
  description: '',
  intent: 'app_password',
  expiring: true,
  expires: defaultExpiry()
})
const creating = ref(false)
const createError = ref(null)

// Per-row transient state.
const copied = ref(null) // identifier whose key was just copied
const busy = ref(null) // identifier of the row with an action in flight
const actionError = ref(null)

function intentLabel(intent) {
  return intent === 'app_password' ? 'App password' : 'API'
}

function formatExpiry(token) {
  if (!token.expiring || !token.expires) {
    return 'Never expires'
  }
  const date = new Date(token.expires)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return `Expires ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

async function onCreate() {
  const identifier = form.identifier.trim()
  if (!identifier) {
    createError.value = 'Please enter a name for the token.'
    return
  }
  if (form.expiring && !form.expires) {
    createError.value = 'Please choose an expiration date.'
    return
  }
  creating.value = true
  createError.value = null
  try {
    await create({
      identifier,
      description: form.description.trim(),
      intent: form.intent,
      expiring: form.expiring,
      // Send an ISO datetime; the date input gives YYYY-MM-DD (UTC midnight).
      expires: form.expiring ? new Date(form.expires).toISOString() : null
    })
    form.identifier = ''
    form.description = ''
    form.intent = 'app_password'
    form.expiring = true
    form.expires = defaultExpiry()
    showCreate.value = false
  } catch (e) {
    createError.value = e?.data?.detail || e?.message || 'Could not create the token.'
  } finally {
    creating.value = false
  }
}

async function onCopy(token) {
  busy.value = token.identifier
  actionError.value = null
  try {
    const key = await viewKey(token.identifier)
    await navigator.clipboard.writeText(key)
    copied.value = token.identifier
    setTimeout(() => {
      if (copied.value === token.identifier) {
        copied.value = null
      }
    }, 2000)
  } catch (e) {
    actionError.value = e?.data?.detail || e?.message || 'Could not copy the token key.'
  } finally {
    busy.value = null
  }
}

async function onDelete(token) {
  busy.value = token.identifier
  actionError.value = null
  try {
    await remove(token.identifier)
  } catch (e) {
    actionError.value = e?.data?.detail || e?.message || 'Could not delete the token.'
  } finally {
    busy.value = null
  }
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    authOrigin.value = window.location.origin
  }
  load()
})
</script>

<template>
  <div>
    <div class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold text-slate-900">Tokens</h1>
        <p class="mt-1 text-sm text-slate-500">
          App passwords and API tokens tied to your account.
        </p>
      </div>
      <button
        class="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-sm
          font-semibold text-white shadow-sm transition hover:bg-sky-500"
        @click="showCreate = !showCreate"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        New token
      </button>
    </div>

    <div v-if="usingSample" class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
      Showing sample tokens (dev) — no live authentik session.
    </div>

    <!-- Help: how to actually use an app password against an app's API. -->
    <div class="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-slate-700"
        @click="showHelp = !showHelp"
      >
        <span class="flex items-center gap-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="h-5 w-5 shrink-0 text-sky-600" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
          </svg>
          How do I use an app password?
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4 shrink-0 text-slate-400 transition" :class="showHelp ? 'rotate-180' : ''" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      <div v-if="showHelp" class="space-y-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
        <p>
          An app password isn't sent to an app directly. You exchange it for a short-lived
          <span class="font-medium text-slate-900">OAuth2 access token</span> at authentik's token
          endpoint, then call the app's API with that access token.
        </p>
        <pre class="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100"><code>{{ exampleCommand }}</code></pre>
        <ul class="list-disc space-y-1 pl-5 text-xs text-slate-500">
          <li>The client ID, scopes and API URL to use are provided by the app. Consult the app documentation for the correct values.</li>
          <li>The access token is short-lived — repeat step 1 when it expires.</li>
          <li>Permissions match your account: the app maps your identity and groups to its own access.</li>
        </ul>
      </div>
    </div>

    <!-- Create form -->
    <form
      v-if="showCreate"
      class="mb-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
      @submit.prevent="onCreate"
    >
      <fieldset>
        <legend class="field-label">Token type</legend>
        <div class="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label
            class="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition"
            :class="
              form.intent === 'app_password'
                ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-500'
                : 'border-slate-300 hover:bg-white'
            "
          >
            <input v-model="form.intent" type="radio" value="app_password" class="mt-0.5 accent-sky-600" />
            <span class="min-w-0">
              <span class="block font-medium text-slate-900">App password</span>
              <span class="block text-xs text-slate-500">For app APIs (e.g. Datatracker), via OAuth2 exchange.</span>
            </span>
          </label>

          <label
            class="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition"
            :class="
              form.intent === 'api'
                ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-500'
                : 'border-slate-300 hover:bg-white'
            "
          >
            <input v-model="form.intent" type="radio" value="api" class="mt-0.5 accent-sky-600" />
            <span class="min-w-0">
              <span class="block font-medium text-slate-900">API token</span>
              <span class="block text-xs text-slate-500">Calls authentik's own API directly.</span>
            </span>
          </label>
        </div>
      </fieldset>
      <div>
        <label class="field-label">Name</label>
        <input v-model="form.identifier" class="field-input" placeholder="e.g. ci-pipeline" />
      </div>
      <div>
        <label class="field-label">Description <span class="text-slate-400">(optional)</span></label>
        <input v-model="form.description" class="field-input" placeholder="What is this token for?" />
      </div>
      <div>
        <label class="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            v-model="form.expiring"
            type="checkbox"
            class="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
          />
          Expires
        </label>
        <input
          v-if="form.expiring"
          v-model="form.expires"
          type="date"
          class="field-input mt-2"
        />
        <p v-if="form.expiring" class="mt-1 text-xs text-slate-500">
          The token will be valid until the end of the day.
        </p>
      </div>
      <p v-if="createError" class="text-sm text-red-600">{{ createError }}</p>
      <div class="flex gap-2">
        <button type="submit" class="btn-primary w-auto px-4" :disabled="creating">
          {{ creating ? 'Creating…' : 'Create token' }}
        </button>
        <button
          type="button"
          class="inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium text-slate-600
            hover:text-slate-900"
          @click="showCreate = false"
        >
          Cancel
        </button>
      </div>
    </form>

    <div v-if="actionError" class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ actionError }}
    </div>

    <div v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ error }}
    </div>

    <LoadingState v-else-if="loading" text="Loading your tokens…" />

    <div v-else-if="tokens.length === 0" class="flex flex-col items-center gap-3 py-12 text-center">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" class="h-20 w-20 text-slate-300" aria-hidden="true">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z"
        />
      </svg>
      <p class="text-sm text-slate-500">You don't have any tokens yet.</p>
    </div>

    <ul v-else class="space-y-3">
      <li
        v-for="token in tokens"
        :key="token.identifier"
        class="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
      >
        <span
          aria-hidden="true"
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="h-5 w-5">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z"
            />
          </svg>
        </span>

        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <p class="truncate text-sm font-medium text-slate-900">{{ token.identifier }}</p>
            <span class="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
              {{ intentLabel(token.intent) }}
            </span>
          </div>
          <p v-if="token.description" class="mt-0.5 truncate text-xs text-slate-500">
            {{ token.description }}
          </p>
          <p class="mt-0.5 text-xs text-slate-500">{{ formatExpiry(token) }}</p>
        </div>

        <div class="flex shrink-0 gap-2">
          <button
            class="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white
              px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50
              disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="busy === token.identifier"
            @click="onCopy(token)"
          >
            {{ copied === token.identifier ? 'Copied!' : 'Copy token' }}
          </button>
          <button
            class="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white
              px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-red-300
              hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="busy === token.identifier"
            @click="onDelete(token)"
          >
            Delete
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>
