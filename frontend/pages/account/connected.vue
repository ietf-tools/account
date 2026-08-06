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
  loginDisabled: githubLoginDisabled,
  updating: githubUpdating,
  load: loadGithub,
  refresh: refreshGithub,
  setLoginDisabled: setGithubLoginDisabled
} = useGithubLink()

// The Datatracker section is an offer to migrate, so it's only shown to accounts
// that haven't been linked yet. `attributes.datatracker.linked` isn't visible to
// the browser (/core/users/me/ omits attributes), hence the backend read.
const {
  linked: datatrackerLinked,
  loaded: datatrackerLoaded,
  load: loadDatatracker
} = useDatatrackerLink()

const disconnecting = ref(null)
// Two-step confirm so a destructive click can't unlink a sign-in method by
// accident — holds the connectionPk of the service awaiting confirmation, or
// null. Same pattern as the MFA page's device removal.
const confirming = ref(null)
// Same idea for turning off GitHub sign-in: it keeps the link but drops a way
// into the account, so it gets its own confirm with the consequences spelled out.
// Turning it back *on* is not destructive and goes through unconfirmed.
const confirmingDisable = ref(null)
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

// Opt in or out of signing in with GitHub. The account stays linked either way —
// only authentik's source authentication flow changes behaviour (it reads the flag
// this writes; see backend/routes/github.js).
async function onSetGithubLogin(disabled) {
  actionError.value = null
  actionNotice.value = null
  const ok = await setGithubLoginDisabled(disabled)
  if (!ok) {
    actionError.value = githubError.value
    return
  }
  confirmingDisable.value = null
  actionNotice.value = disabled
    ? 'Signing in with GitHub is now turned off. Your account stays linked.'
    : 'You can sign in with GitHub again.'
}

async function onDisconnect(item) {
  disconnecting.value = item.connectionPk
  actionError.value = null
  actionNotice.value = null
  try {
    // Clear the sign-in opt-out before dropping the link, or it outlives the
    // connection it described and silently blocks sign-in if GitHub is ever
    // reconnected. Must happen first — the endpoint requires a live connection.
    // Best-effort: a failure here shouldn't stop the disconnect the user asked for.
    if (isGithub(item) && githubLoginDisabled.value) {
      await setGithubLoginDisabled(false)
    }
    await disconnect(item)
    confirmingDisable.value = null
    confirming.value = null
  } catch (e) {
    actionError.value = e?.data?.detail || e?.message || 'Could not disconnect that service.'
  } finally {
    disconnecting.value = null
  }
}

onMounted(async () => {
  loadDatatracker()
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
            class="rounded-xl border border-slate-200 bg-slate-50 p-4"
          >
            <div class="flex items-center gap-3">
              <SourceIcon :slug="item.slug" :name="item.name" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <p class="truncate text-sm font-medium text-slate-900">{{ item.name }}</p>
                  <!-- Linked but not usable to sign in — worth saying on the row
                       itself, since the whole point is that the two differ. -->
                  <span
                    v-if="isGithub(item) && githubLoginDisabled"
                    class="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                  >
                    Sign-in off
                  </span>
                </div>
                <p v-if="metaLine(item)" class="mt-0.5 text-xs text-slate-500">
                  {{ metaLine(item) }}
                </p>
              </div>
              <!-- Two-step confirm: swap the actions menu for confirm/cancel -->
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

              <!-- Every row's actions live behind one "…" menu, so the rows stay
                   uniform whether a service has one action (Apple, Google) or
                   several (GitHub). -->
              <ActionMenu
                v-else
                :label="`${item.name} account actions`"
                :disabled="isGithub(item) && (githubRefreshing || githubUpdating)"
              >
                <template #default="{ close }">
                  <!-- GitHub only: pull the username in from the linked account,
                       for users who linked it while signed in (no flow ran, so
                       authentik never wrote it) or who changed it on GitHub since. -->
                  <button
                    v-if="isGithub(item)"
                    type="button"
                    class="menu-item"
                    role="menuitem"
                    @click="close(); onRefreshGithub()"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="h-4 w-4 shrink-0 text-slate-400"
                      aria-hidden="true"
                    >
                      <polyline points="23 4 23 10 17 10" />
                      <polyline points="1 20 1 14 7 14" />
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                    <span>Refresh Username</span>
                  </button>

                  <button
                    v-if="isGithub(item) && githubLoginDisabled"
                    type="button"
                    class="menu-item"
                    role="menuitem"
                    @click="close(); onSetGithubLogin(false)"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.75"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="h-4 w-4 shrink-0 text-slate-400"
                      aria-hidden="true"
                    >
                      <path d="M9 12.75 11.25 15 15 9.75" />
                      <circle cx="12" cy="12" r="9" />
                    </svg>
                    <span>Enable Sign-In</span>
                  </button>
                  <button
                    v-else-if="isGithub(item)"
                    type="button"
                    class="menu-item"
                    role="menuitem"
                    @click="close(); confirmingDisable = item.connectionPk"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.75"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="h-4 w-4 shrink-0 text-slate-400"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="9" />
                      <path d="M5.64 5.64l12.72 12.72" />
                    </svg>
                    <span>Disable Sign-In</span>
                  </button>

                  <button
                    type="button"
                    class="menu-item text-red-600"
                    role="menuitem"
                    @click="close(); confirming = item.connectionPk"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.75"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="h-4 w-4 shrink-0 text-red-400"
                      aria-hidden="true"
                    >
                      <!-- Two link halves pulled apart, with motion ticks. -->
                      <path d="m18.84 12.25 1.72-1.71a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" />
                      <path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" />
                      <line x1="8" y1="2" x2="8" y2="5" />
                      <line x1="2" y1="8" x2="5" y2="8" />
                      <line x1="16" y1="19" x2="16" y2="22" />
                      <line x1="19" y1="16" x2="22" y2="16" />
                    </svg>
                    <span>Disconnect</span>
                  </button>
                </template>
              </ActionMenu>
            </div>

            <!-- Disable-sign-in confirm. Full width under the row rather than an
                 inline swap: the consequences need spelling out, and they don't
                 fit next to the service name. -->
            <div
              v-if="confirmingDisable === item.connectionPk"
              class="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3"
            >
              <p class="text-sm font-medium text-amber-900">Turn off signing in with GitHub?</p>
              <p class="mt-1 text-sm text-amber-800">
                Your GitHub account stays connected and keeps showing on your profile — you just
                won't be able to use it to sign in. Make sure you can still get in another way
                (your email and password, or a passkey) first; otherwise you'll need to reset your
                password to regain access. You can turn this back on from this menu at any time.
              </p>
              <div class="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  class="inline-flex shrink-0 items-center justify-center rounded-lg bg-amber-600 px-3 py-2
                    text-sm font-semibold text-white shadow-sm transition hover:bg-amber-500
                    disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="githubUpdating"
                  @click="onSetGithubLogin(true)"
                >
                  {{ githubUpdating ? 'Turning off…' : 'Yes, disable sign-in' }}
                </button>
                <button
                  type="button"
                  class="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-300
                    bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition
                    hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="githubUpdating"
                  @click="confirmingDisable = null"
                >
                  Cancel
                </button>
              </div>
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

    <!-- Datatracker: only an offer to migrate, so it's hidden once linked (and
         until we know, to avoid flashing it at accounts that already are). -->
    <section v-if="datatrackerLoaded && !datatrackerLinked" class="mt-8 border-t border-slate-100 pt-4">
      <h2 class="text-base font-semibold text-slate-900">Datatracker</h2>
      <p class="mt-1 text-sm text-slate-500">Legacy datatracker accounts created before the introduction of IETF Accounts can be migrated and linked to your IETF Account.</p>

      <div class="mt-4 flex justify-end">
        <button
          type="button"
          class="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-300
            bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition
            hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
        >
          Migrate Datatracker Account
        </button>
      </div>
    </section>
  </div>
</template>
