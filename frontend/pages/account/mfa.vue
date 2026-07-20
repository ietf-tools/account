<script setup>
// The signed-in user's MFA authenticators: list, remove, and enroll new ones.
// Listing/removal come from useMfa(); enrollment drives authentik's per-type
// setup flows through an embedded FlowExecutor.
definePageMeta({ middleware: 'auth', layout: 'account' })

const { devices, loading, error, usingSample, load, remove } = useMfa()

const removing = ref(null)
const actionError = ref(null)
const enrollSuccess = ref(null)

// Which setup flow is being enrolled (a key in runtimeConfig.public.flows), or
// null when just listing.
const enrolling = ref(null)
// "Add authenticator" dropdown open state.
const menuOpen = ref(false)

const ENROLL_OPTIONS = [
  {
    kind: 'totpSetup',
    label: 'Authenticator app',
    subtitle: 'TOTP',
    title: 'Add authenticator app',
    icon: 'M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3'
  },
  {
    kind: 'webauthnSetup',
    label: 'Passkey / Security key',
    subtitle: 'WebAuthn',
    title: 'Add passkey or security key',
    icon: 'M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004.5 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 01-3.6 9.75m6.633-4.596a18.666 18.666 0 01-2.485 5.33'
  },
  {
    kind: 'staticSetup',
    label: 'Recovery codes',
    subtitle: 'Static',
    title: 'Generate recovery codes',
    icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z'
  }
]

const enrollTitle = computed(
  () => ENROLL_OPTIONS.find((option) => option.kind === enrolling.value)?.title ?? 'Add authenticator'
)

function startEnroll(kind) {
  enrollSuccess.value = null
  actionError.value = null
  enrolling.value = kind
}

function selectOption(kind) {
  menuOpen.value = false
  startEnroll(kind)
}

async function onEnrolled() {
  enrolling.value = null
  enrollSuccess.value = 'Authenticator added.'
  await load()
}

async function onRemove(device) {
  removing.value = device.pk
  actionError.value = null
  try {
    await remove(device)
  } catch (e) {
    actionError.value = e?.data?.detail || e?.message || 'Could not remove that authenticator.'
  } finally {
    removing.value = null
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold text-slate-900">MFA Authenticators</h1>
        <p class="mt-1 text-sm text-slate-500">Manage the two-factor methods on your account.</p>
      </div>

      <div class="relative shrink-0">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-sm
            font-semibold text-white shadow-sm transition hover:bg-sky-500"
          @click="menuOpen = !menuOpen"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add authenticator
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        <template v-if="menuOpen">
          <!-- Transparent backdrop closes the menu on any outside click. -->
          <div class="fixed inset-0 z-10" @click="menuOpen = false" />
          <div
            class="absolute right-0 z-20 mt-2 w-60 divide-y divide-slate-100 overflow-hidden
              rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          >
            <button
              v-for="option in ENROLL_OPTIONS"
              :key="option.kind"
              type="button"
              class="flex w-full items-center gap-2.5 px-4 py-2 text-left text-slate-700 transition hover:bg-slate-50"
              @click="selectOption(option.kind)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" :d="option.icon" />
              </svg>
              <span class="min-w-0">
                <span class="block text-sm">{{ option.label }}</span>
                <span class="block text-xs text-slate-400">{{ option.subtitle }}</span>
              </span>
            </button>
          </div>
        </template>
      </div>
    </div>

    <div v-if="usingSample" class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
      Showing sample authenticators (dev) — no live authentik session.
    </div>

    <div v-if="enrollSuccess" class="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
      {{ enrollSuccess }}
    </div>

    <div v-if="actionError" class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ actionError }}
    </div>

    <!-- Enrollment: an embedded setup flow for the chosen device type -->
    <div v-if="enrolling" class="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-slate-700">{{ enrollTitle }}</h2>
        <button type="button" class="link text-sm" @click="enrolling = null">Cancel</button>
      </div>
      <FlowExecutor :key="enrolling" :kind="enrolling" embedded @complete="onEnrolled" />
    </div>

    <template v-else>
      <div v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</div>

      <LoadingState v-else-if="loading" text="Loading your authenticators…" />

      <div v-else-if="devices.length === 0" class="flex flex-col items-center gap-3 py-12 text-center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" class="h-20 w-20 text-slate-300" aria-hidden="true">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.249-8.25-3.286z"
          />
        </svg>
        <p class="text-sm text-slate-500">You don't have any two-factor authenticators set up yet.</p>
      </div>

      <ul v-else class="space-y-3">
        <li
          v-for="device in devices"
          :key="`${device.kind}-${device.pk}`"
          class="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
        >
          <span
            aria-hidden="true"
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="h-5 w-5">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.249-8.25-3.286z"
              />
            </svg>
          </span>

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <p class="truncate text-sm font-medium text-slate-900">{{ device.name }}</p>
              <span
                v-if="!device.confirmed"
                class="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
              >
                Pending
              </span>
            </div>
            <p class="mt-0.5 text-xs text-slate-500">{{ device.kindLabel }}</p>
          </div>

          <button
            class="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-300
              bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition
              hover:border-red-300 hover:bg-red-50 hover:text-red-700
              disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="removing === device.pk"
            @click="onRemove(device)"
          >
            {{ removing === device.pk ? 'Removing…' : 'Remove' }}
          </button>
        </li>
      </ul>
    </template>
  </div>
</template>
