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

    <div v-else-if="loading" class="py-10 text-center text-sm text-slate-500">
      Loading your sessions…
    </div>

    <div v-else-if="sessions.length === 0" class="py-10 text-center text-sm text-slate-500">
      No active sessions.
    </div>

    <ul v-else class="space-y-3">
      <li
        v-for="session in sessions"
        :key="session.uuid"
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
              d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25"
            />
          </svg>
        </span>

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
            <span v-if="session.location"> · {{ session.location }}</span>
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
          {{ revoking === session.uuid ? 'Signing out…' : 'Sign out' }}
        </button>
      </li>
    </ul>
  </div>
</template>
