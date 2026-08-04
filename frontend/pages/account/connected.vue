<script setup>
// Manage the user's linked social logins (OAuth sources). List + disconnect via
// useConnectedSources(); connecting is a full-page redirect to authentik's source
// login endpoint, which links the source to the already-authenticated account.
definePageMeta({ middleware: 'auth', layout: 'account' })

const { connected, available, loading, error, usingSample, load, disconnect } =
  useConnectedSources()

const disconnecting = ref(null)
// Two-step confirm so a destructive click can't unlink a sign-in method by
// accident — holds the connectionPk of the service awaiting confirmation, or
// null. Same pattern as the MFA page's device removal.
const confirming = ref(null)
const actionError = ref(null)

function formatDate(value) {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Start linking a source: a full-page redirect to authentik (same-origin in
// prod). Because we're already signed in, authentik links it to this account and
// returns to `next`. Can't complete in local dev (cross-site cookie).
function onConnect(source) {
  const next = window.location.href
  window.location.href = `/source/oauth/login/${source.slug}/?next=${encodeURIComponent(next)}`
}

async function onDisconnect(item) {
  disconnecting.value = item.connectionPk
  actionError.value = null
  try {
    await disconnect(item)
    confirming.value = null
  } catch (e) {
    actionError.value = e?.data?.detail || e?.message || 'Could not disconnect that service.'
  } finally {
    disconnecting.value = null
  }
}

onMounted(load)
</script>

<template>
  <div>
    <TabHeader title="Connected Services" subtitle="Social accounts you can use to sign in." />

    <div v-if="usingSample" class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
      Showing sample connections (dev) — no live authentik session.
    </div>

    <div v-if="actionError" class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ actionError }}
    </div>

    <div v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</div>

    <LoadingState v-else-if="loading" text="Loading your connected services…" />

    <div v-else-if="connected.length === 0 && available.length === 0" class="py-10 text-center text-sm text-slate-500">
      There are no social services available to connect.
    </div>

    <div v-else class="space-y-8">
      <section v-if="connected.length">
        <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Connected</h2>
        <ul class="space-y-3">
          <li
            v-for="item in connected"
            :key="item.connectionPk"
            class="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
          >
            <SourceIcon :slug="item.slug" :name="item.name" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-slate-900">{{ item.name }}</p>
              <p v-if="formatDate(item.created)" class="mt-0.5 text-xs text-slate-500">
                Connected {{ formatDate(item.created) }}
              </p>
            </div>
            <!-- Two-step confirm: swap the Disconnect button for confirm/cancel -->
            <div v-if="confirming === item.connectionPk" class="flex shrink-0 items-center gap-2">
              <button
                type="button"
                class="inline-flex shrink-0 items-center justify-center rounded-lg bg-red-600 px-3 py-2
                  text-sm font-semibold text-white shadow-sm transition hover:bg-red-500
                  disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="disconnecting === item.connectionPk"
                @click="onDisconnect(item)"
              >
                {{ disconnecting === item.connectionPk ? 'Disconnecting…' : 'Yes, disconnect' }}
              </button>
              <button
                type="button"
                class="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-300
                  bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition
                  hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="disconnecting === item.connectionPk"
                @click="confirming = null"
              >
                Cancel
              </button>
            </div>

            <button
              v-else
              type="button"
              class="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-300
                bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition
                hover:border-red-300 hover:bg-red-50 hover:text-red-700
                disabled:cursor-not-allowed disabled:opacity-50"
              @click="confirming = item.connectionPk"
            >
              Disconnect
            </button>
          </li>
        </ul>
      </section>

      <section v-if="available.length">
        <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Available</h2>
        <ul class="space-y-3">
          <li
            v-for="source in available"
            :key="source.slug"
            class="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
          >
            <SourceIcon :slug="source.slug" :name="source.name" />
            <p class="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{{ source.name }}</p>
            <button
              class="inline-flex shrink-0 items-center justify-center rounded-lg bg-sky-600 px-3 py-2
                text-sm font-semibold text-white shadow-sm transition hover:bg-sky-500"
              @click="onConnect(source)"
            >
              Connect
            </button>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
