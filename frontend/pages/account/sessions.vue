<script setup>
// Active sessions for the signed-in user, with the ability to terminate any that
// isn't the current one. Data + actions come from useSessions() (authentik's
// /core/authenticated_sessions/).
definePageMeta({ middleware: 'auth', layout: 'account' })

const { sessions, loading, error, usingSample, load, revoke } = useSessions()

// uuid currently being terminated (for the per-row disabled/spinner state), and a
// separate error surfaced if a revoke fails.
const revoking = ref(null)
const revokeError = ref(null)

function deviceLabel(session) {
  if (session.browser && session.os) {
    return `${session.browser} on ${session.os}`
  }
  return session.browser || session.os || session.rawUserAgent || 'Unknown device'
}

// Turn an ISO 3166-1 alpha-2 country code into its flag emoji by mapping each
// letter to the corresponding Unicode regional indicator symbol. Returns '' for
// anything that isn't a two-letter code.
function flagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) {
    return ''
  }
  const code = countryCode.toUpperCase()
  if (!/^[A-Z]{2}$/.test(code)) {
    return ''
  }
  const base = 0x1f1e6
  return String.fromCodePoint(base + code.charCodeAt(0) - 65, base + code.charCodeAt(1) - 65)
}

function formatDate(value) {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  })
}

async function onRevoke(session) {
  revoking.value = session.uuid
  revokeError.value = null
  try {
    await revoke(session.uuid)
  } catch (e) {
    revokeError.value = e?.data?.detail || e?.message || 'Could not sign out that session.'
  } finally {
    revoking.value = null
  }
}

onMounted(load)
</script>

<template>
  <div>
    <TabHeader title="Sessions" subtitle="Devices where you're currently signed in." />

    <div v-if="usingSample" class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
      Showing sample sessions (dev) — no live authentik session.
    </div>

    <div v-if="revokeError" class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ revokeError }}
    </div>

    <div v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ error }}
    </div>

    <LoadingState v-else-if="loading" text="Loading your sessions…" />

    <div v-else-if="sessions.length === 0" class="py-10 text-center text-sm text-slate-500">
      No active sessions.
    </div>

    <ul v-else class="space-y-3">
      <li
        v-for="session in sessions"
        :key="session.uuid"
        class="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
      >
        <OsIcon :os="session.os" />

        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <p class="truncate text-sm font-medium text-slate-900">{{ deviceLabel(session) }}</p>
            <span
              v-if="session.current"
              class="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700"
            >
              This session
            </span>
          </div>
          <p class="mt-0.5 text-xs text-slate-500">
            <span v-if="session.ip">{{ session.ip }}</span>
            <span v-if="session.location"> · <span v-if="flagEmoji(session.countryCode)" aria-hidden="true" class="mr-1">{{ flagEmoji(session.countryCode) }}</span>{{ session.location }}</span>
          </p>
          <p v-if="formatDate(session.lastUsed)" class="mt-0.5 text-xs text-slate-500">
            Last active {{ formatDate(session.lastUsed) }}
          </p>
        </div>

        <button
          v-if="!session.current"
          class="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-300
            bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition
            hover:border-red-300 hover:bg-red-50 hover:text-red-700
            disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="revoking === session.uuid"
          @click="onRevoke(session)"
        >
          {{ revoking === session.uuid ? 'Terminating…' : 'Terminate' }}
        </button>
      </li>
    </ul>
  </div>
</template>
