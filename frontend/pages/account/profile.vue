<script setup>
// Edit the signed-in user's details via authentik's user-settings flow. Fields
// are whatever that flow's prompt stage defines (name, pronouns, …), so the form
// is rendered generically from useProfile(). Email is NOT editable here — it's
// changed through a dedicated, verified flow (see "Change email" below), which
// also keeps the username identical to the email server-side.
definePageMeta({ middleware: 'auth', layout: 'account' })

const { fields, values, nonFieldErrors, loading, saving, error, saved, usingSample, load, save, errorFor } =
  useProfile()
const auth = useAuthStore()

// Whether the embedded change-email flow is showing. When true we hide the
// profile form to keep the flow the sole focus (mirrors mfa.vue enrollment).
//
// This embedded flow only drives the FIRST half: collect the new address and
// trigger authentik's verification email. It then pauses on the Email stage
// (FlowExecutor renders "check your inbox") — it does NOT complete here. The
// change is applied only when the user opens the link in that email, which lands
// on verify-email-change.vue (pre-fetch-safe; see README "Change email address").
const changingEmail = ref(false)

function startEmailChange() {
  changingEmail.value = true
}

async function onEmailChanged() {
  // Defensive only: reached if a flow variant completes inline without an email
  // gate. The verified path completes on verify-email-change.vue, not here.
  changingEmail.value = false
  await auth.fetchSession()
  await load()
}

onMounted(load)
</script>

<template>
  <div>
    <TabHeader title="Profile" subtitle="Your name, email and other account details." />

    <div v-if="usingSample" class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
      Showing a sample form (dev) — no live authentik session.
    </div>

    <!-- Change email: a dedicated verified flow, driven inline here. This half
         only collects the new address and sends the verification email; the change
         takes effect when the user clicks the link (verify-email-change.vue). -->
    <div v-if="changingEmail" class="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-slate-700">Change email address</h2>
        <button type="button" class="link text-sm" @click="changingEmail = false">Cancel</button>
      </div>
      <p class="mb-3 text-sm text-slate-500">
        Enter your new email address. We'll send a link there to confirm it — your address
        (and sign-in) only changes once you open that link.
      </p>
      <FlowExecutor kind="emailChange" embedded @complete="onEmailChanged" />
    </div>

    <template v-else>
      <div v-if="saved" class="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
        Your profile has been updated.
      </div>

      <div v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</div>

      <LoadingState v-else-if="loading" text="Loading your profile…" />

      <template v-else>
        <form @submit.prevent="save" class="space-y-4">
          <div
            v-for="msg in nonFieldErrors"
            :key="msg.code"
            class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {{ msg.string }}
          </div>

          <PromptFields :fields="fields" :values="values" :error-for="errorFor" />

          <div class="flex justify-end">
            <button type="submit" class="btn-primary w-auto px-4" :disabled="saving">
              {{ saving ? 'Saving…' : 'Save changes' }}
            </button>
          </div>
        </form>

        <!-- Email is managed separately so the change can be verified before it
             takes effect (and the username kept in sync server-side). -->
        <div class="mt-6 border-t border-slate-200 pt-6">
          <div class="flex items-center justify-between gap-4">
            <div class="min-w-0">
              <p class="text-sm font-medium text-slate-900">Email address</p>
              <p class="mt-0.5 truncate text-sm text-slate-500">
                {{ auth.user?.email || '—' }}
              </p>
            </div>
            <button
              type="button"
              class="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-300
                bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition
                hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
              @click="startEmailChange"
            >
              Change email
            </button>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
