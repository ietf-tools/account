<script setup>
// Manage the user's linked social logins (OAuth sources). List + disconnect via
// useConnectedSources(); connecting is a full-page redirect to authentik's source
// login endpoint, which links the source to the already-authenticated account.
definePageMeta({ middleware: 'auth', layout: 'account' })

const { connected, available, loading, error, usingSample, load, disconnect } =
  useConnectedSources()

// GitHub's username isn't part of the connection (authentik only stores the numeric
// account id), and it's only written to the user's attributes when someone signs up
// or signs in *with* GitHub — linking it while already signed in runs no flow. The
// refresh button on that row resolves it via the backend. See useGithubLink.
const {
  username: githubUsername,
  refreshing: githubRefreshing,
  error: githubError,
  load: loadGithub,
  refresh: refreshGithub
} = useGithubLink()

const disconnecting = ref(null)
// Two-step confirm so a destructive click can't unlink a sign-in method by
// accident — holds the connectionPk of the service awaiting confirmation, or
// null. Same pattern as the MFA page's device removal.
const confirming = ref(null)
const actionError = ref(null)
const actionNotice = ref(null)

function isGithub(item) {
  return sourceBrand(`${item.slug} ${item.name}`) === 'github'
}

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

// Sub-line under a connection's name: the GitHub handle we have on file (when it's
// the GitHub row) and when the account was linked.
function metaLine(item) {
  const parts = []
  if (isGithub(item) && githubUsername.value) {
    parts.push(`@${githubUsername.value}`)
  }
  const created = formatDate(item.created)
  if (created) {
    parts.push(`Connected ${created}`)
  }
  return parts.join(' · ')
}

// Start linking a source: a full-page redirect to authentik (same-origin in
// prod). Because we're already signed in, authentik links it to this account and
// returns to `next`. Can't complete in local dev (cross-site cookie).
function onConnect(source) {
  const next = window.location.href
  window.location.href = `/source/oauth/login/${source.slug}/?next=${encodeURIComponent(next)}`
}

// Resolve (or re-resolve) the GitHub username from the linked account's numeric id
// and store it on the user's attributes.
async function onRefreshGithub() {
  actionError.value = null
  actionNotice.value = null
  const ok = await refreshGithub()
  if (!ok) {
    actionError.value = githubError.value
    return
  }
  actionNotice.value = githubUsername.value
    ? `Saved your GitHub username (@${githubUsername.value}) to your profile.`
    : 'Your GitHub account details were refreshed.'
}

async function onDisconnect(item) {
  disconnecting.value = item.connectionPk
  actionError.value = null
  actionNotice.value = null
  try {
    await disconnect(item)
    confirming.value = null
  } catch (e) {
    actionError.value = e?.data?.detail || e?.message || 'Could not disconnect that service.'
  } finally {
    disconnecting.value = null
  }
}

onMounted(async () => {
  await load()
  // Only worth a backend round-trip when GitHub is actually linked.
  if (connected.value.some(isGithub)) {
    await loadGithub()
  }
})
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

    <div v-if="actionNotice" class="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
      {{ actionNotice }}
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
              <p v-if="metaLine(item)" class="mt-0.5 text-xs text-slate-500">
                {{ metaLine(item) }}
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

            <div v-else class="flex shrink-0 items-center gap-2">
              <!-- GitHub only: pull the username in from the linked account, for
                   users who linked it while signed in (no flow ran, so authentik
                   never wrote it) or who changed it on GitHub since. -->
              <button
                v-if="isGithub(item)"
                type="button"
                class="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-300
                  bg-white p-2.5 text-slate-500 shadow-sm transition hover:border-sky-300
                  hover:bg-sky-50 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="githubRefreshing"
                title="Refresh GitHub username"
                aria-label="Refresh GitHub username"
                @click="onRefreshGithub()"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="h-4 w-4"
                  :class="githubRefreshing ? 'animate-spin' : ''"
                  aria-hidden="true"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              </button>

              <button
                type="button"
                class="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-300
                  bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition
                  hover:border-red-300 hover:bg-red-50 hover:text-red-700
                  disabled:cursor-not-allowed disabled:opacity-50"
                @click="confirming = item.connectionPk"
              >
                Disconnect
              </button>
            </div>
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
