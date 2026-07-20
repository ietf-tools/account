<script setup>
// The signed-in user's API tokens: list, create, copy the secret, delete.
// Data + actions come from useTokens() (authentik's /core/tokens/).
definePageMeta({ middleware: 'auth', layout: 'account' })

const { tokens, loading, error, usingSample, load, create, remove, viewKey } = useTokens()

// Default expiry for new tokens: 30 days out, as a YYYY-MM-DD value for the date
// input.
function defaultExpiry() {
  const date = new Date()
  date.setDate(date.getDate() + 30)
  return date.toISOString().slice(0, 10)
}

// Create form. Tokens expire by default.
const showCreate = ref(false)
const form = reactive({ identifier: '', description: '', expiring: true, expires: defaultExpiry() })
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
      expiring: form.expiring,
      // Send an ISO datetime; the date input gives YYYY-MM-DD (UTC midnight).
      expires: form.expiring ? new Date(form.expires).toISOString() : null
    })
    form.identifier = ''
    form.description = ''
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

onMounted(load)
</script>

<template>
  <div>
    <div class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold text-slate-900">Tokens</h1>
        <p class="mt-1 text-sm text-slate-500">API tokens tied to your account.</p>
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

    <!-- Create form -->
    <form
      v-if="showCreate"
      class="mb-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
      @submit.prevent="onCreate"
    >
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

    <div v-else-if="loading" class="py-10 text-center text-sm text-slate-500">
      Loading your tokens…
    </div>

    <div v-else-if="tokens.length === 0" class="py-10 text-center text-sm text-slate-500">
      You don't have any tokens yet.
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
            {{ copied === token.identifier ? 'Copied!' : 'Copy' }}
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
