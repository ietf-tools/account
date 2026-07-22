<script setup>
// Edit the signed-in user's details via authentik's user-settings flow. Fields
// are whatever that flow's prompt stage defines (name, pronouns, …), so the form
// is rendered generically from useProfile(). Email is NOT editable here — it's
// changed through a dedicated, verified backend flow (see "Change email" below),
// which also keeps the username identical to the email.
definePageMeta({ middleware: 'auth', layout: 'account' })

const { fields, values, nonFieldErrors, loading, saving, error, saved, usingSample, load, save, errorFor } =
  useProfile()
const auth = useAuthStore()
const api = useApi()
const route = useRoute()
const router = useRouter()

// Change-email UI state. This half only requests the change and triggers the
// verification email; the change is applied when the user opens the link, which
// lands on verify-email-change.vue (pre-fetch-safe; backend-driven).
const showEmailForm = ref(false)
const newEmail = ref('')
const emailError = ref(null)
const sending = ref(false)
const sentTo = ref(null)

// Success banner after the confirmation link is opened (verify-email-change.vue
// routes back here with ?changed=1).
const justChanged = ref(route.query.changed === '1')

function openEmailForm() {
  emailError.value = null
  sentTo.value = null
  newEmail.value = ''
  showEmailForm.value = true
}

function cancelEmailForm() {
  showEmailForm.value = false
  emailError.value = null
}

async function submitEmailChange() {
  emailError.value = null
  sending.value = true
  try {
    const res = await api('/email-change', { method: 'POST', body: { email: newEmail.value.trim() } })
    sentTo.value = res.email
    showEmailForm.value = false
  } catch (e) {
    emailError.value = e?.data?.error || e?.message || 'Could not start the email change. Please try again.'
  } finally {
    sending.value = false
  }
}

onMounted(async () => {
  if (justChanged.value) {
    // Identity changed on the confirm page — refresh so the sidebar/address here
    // reflect it, then drop the query param so a refresh doesn't re-show it.
    await auth.fetchSession()
    router.replace({ query: {} })
  }
  await load()
})
</script>

<template>
  <div>
    <TabHeader title="Profile" subtitle="Your name, email and other account details." />

    <div v-if="usingSample" class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
      Showing a sample form (dev) — no live authentik session.
    </div>

    <div v-if="justChanged" class="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
      Your email address has been updated.
    </div>

    <div v-if="saved" class="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
      Your profile has been updated.
    </div>

    <div v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</div>

    <LoadingState v-else-if="loading" text="Loading your profile…" />

    <template v-else>
      <!-- Email is managed separately so the new address can be verified (a link
           sent to it) before it takes effect, and the username kept in sync. Shown
           first, with a separator before the rest of the profile fields. -->
      <div class="mb-6 border-b border-slate-200 pb-6">
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <p class="text-sm font-medium text-slate-900">Email address</p>
            <p class="mt-0.5 truncate text-sm text-slate-500">{{ auth.user?.email || '—' }}</p>
          </div>
          <button
            v-if="!showEmailForm"
            type="button"
            class="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-300
              bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition
              hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
            @click="openEmailForm"
          >
            Change email
          </button>
        </div>

        <!-- "Check your inbox" confirmation after a request is sent. -->
        <div v-if="sentTo" class="mt-4 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
          We've sent a confirmation link to <span class="font-medium">{{ sentTo }}</span>. Open it to
          finish changing your email — your address won't change until you do.
        </div>

        <!-- New-address form. -->
        <form v-if="showEmailForm" class="mt-4 space-y-3" @submit.prevent="submitEmailChange">
          <div>
            <label class="field-label" for="new-email">New email address</label>
            <input
              id="new-email"
              v-model="newEmail"
              type="email"
              class="field-input"
              autocomplete="email"
              placeholder="you@example.com"
              required
            />
            <p class="mt-1 text-xs text-slate-500">
              We'll send a confirmation link to this email address. Your email (and sign-in) only changes
              once you click it and confirm the modification.
            </p>
            <p v-if="emailError" class="mt-1 text-sm text-red-600">{{ emailError }}</p>
          </div>
          <div class="flex justify-end gap-3">
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-lg border border-slate-300
                bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition
                hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="sending"
              @click="cancelEmailForm"
            >
              Cancel
            </button>
            <button type="submit" class="btn-primary w-auto px-4" :disabled="sending">
              {{ sending ? 'Sending…' : 'Send confirmation link' }}
            </button>
          </div>
        </form>
      </div>

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
    </template>
  </div>
</template>
