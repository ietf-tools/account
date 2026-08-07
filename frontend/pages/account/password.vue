<script setup>
// Change the signed-in user's password via authentik's password-change flow.
// Fields (and password policies) come from that flow's prompt stage, rendered by
// the shared PromptFields component; driving lives in usePassword().
definePageMeta({ middleware: 'auth', layout: 'account' })

const { fields, values, nonFieldErrors, loading, saving, error, saved, usingSample, load, save, errorFor } =
  usePassword()

// "Go Passwordless": remove the password entirely once the user has a passkey or
// a linked social login to sign in with. Detection + removal live in the
// composable (removal goes through the backend, which re-checks eligibility).
const {
  hasPasskeys,
  hasSocial,
  canRemove,
  loading: methodsLoading,
  removing,
  removed,
  error: removeError,
  load: loadMethods,
  remove: removePassword
} = usePasswordless()

// Two-step confirm so a destructive click can't fire by accident.
const confirming = ref(false)

async function onRemove() {
  await removePassword()
  confirming.value = false
}

onMounted(() => {
  load()
  loadMethods()
})
</script>

<template>
  <div>
    <TabHeader title="Password" subtitle="Set a new password for your account." />

    <div v-if="usingSample" class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
      Showing a sample form (dev) — no live authentik session.
    </div>

    <div v-if="saved" class="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
      Your password has been changed.
    </div>

    <div v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</div>

    <LoadingState v-else-if="loading" text="Loading…" />

    <form v-else @submit.prevent="save" class="space-y-4">
      <div
        v-for="msg in nonFieldErrors"
        :key="msg.code"
        class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
      >
        {{ msg.string }}
      </div>

      <PromptFields :fields="fields" :values="values" :error-for="errorFor" password-strength />

      <div class="flex justify-end">
        <button type="submit" class="btn-primary w-auto px-4" :disabled="saving">
          {{ saving ? 'Changing…' : 'Change password' }}
        </button>
      </div>
    </form>

    <!-- Go Passwordless -->
    <section class="mt-4 border-t border-slate-100 pt-4">
      <h2 class="text-base font-semibold text-slate-900">Go Passwordless</h2>
      <p class="mt-1 text-sm text-slate-500">
        You can remove the password from your account and sign in using only your passkeys or
        connected social logins for stronger security. This is available once one or more of the following are set up:
      </p>

      <ul class="mt-4 space-y-2">
        <li class="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
          <span class="text-sm text-slate-700">Passkeys</span>
          <span
            v-if="hasPasskeys"
            class="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-3.5 w-3.5" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            Set up
          </span>
          <span
            v-else
            class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-400"
          >
            Not set up
          </span>
        </li>
        <li class="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
          <span class="text-sm text-slate-700">Social Logins</span>
          <span
            v-if="hasSocial"
            class="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-3.5 w-3.5" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            Set up
          </span>
          <span
            v-else
            class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-400"
          >
            Not set up
          </span>
        </li>
      </ul>

      <div v-if="removed" class="mt-6 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
        Your password has been removed. You'll sign in with your passkey or a connected social
        login from now on.
      </div>

      <template v-else>
        <div v-if="removeError" class="mt-6 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {{ removeError }}
        </div>

        <!-- Confirmation step -->
        <div v-if="confirming" class="mt-6 rounded-xl border border-red-200 bg-red-50 p-4">
          <p class="text-sm text-red-800">
            Remove your password? You'll only be able to sign in with your passkeys or connected
            social logins. You can set a new password later using account recovery.
          </p>
          <div class="mt-4 flex gap-3">
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm
                font-semibold text-white shadow-sm transition hover:bg-red-500
                disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="removing"
              @click="onRemove"
            >
              {{ removing ? 'Removing…' : 'Yes, remove it' }}
            </button>
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-lg border border-slate-300
                bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition
                hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="removing"
              @click="confirming = false"
            >
              Cancel
            </button>
          </div>
        </div>

        <div v-else class="mt-6 flex flex-col items-end">
          <button
            type="button"
            class="inline-flex items-center justify-center rounded-lg border border-red-300
              bg-white px-4 py-2 text-sm font-semibold text-red-700 shadow-sm transition
              hover:border-red-400 hover:bg-red-50
              disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-white
              disabled:text-slate-400"
            :disabled="!canRemove || methodsLoading"
            @click="confirming = true"
          >
            Remove Password
          </button>

          <p v-if="!canRemove && !methodsLoading" class="mt-2 text-right text-xs text-slate-400">
            Set up a passkey or connect a social login to enable this.
          </p>
        </div>
      </template>

      <div class="mt-6 flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2.5 text-sm text-sky-800">
        <svg viewBox="0 0 24 24" fill="currentColor" class="mt-0.5 h-5 w-5 shrink-0 text-sky-500" aria-hidden="true">
          <path
            fill-rule="evenodd"
            d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm8.706-1.442c1.146-.573 2.437.463 2.126 1.706l-.709 2.836.042-.02a.75.75 0 01.67 1.34l-.04.022c-1.147.573-2.438-.463-2.127-1.706l.71-2.836-.042.02a.75.75 0 11-.671-1.34l.041-.022zM12 9a.75.75 0 100-1.5.75.75 0 000 1.5z"
            clip-rule="evenodd"
          />
        </svg>
        <p>
          If you ever get locked out, you can always use
          <NuxtLink to="/recover" class="link">Forgot password</NuxtLink> to set a new password and
          regain access.
        </p>
      </div>
    </section>
  </div>
</template>
