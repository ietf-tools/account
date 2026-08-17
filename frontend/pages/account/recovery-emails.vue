<script setup>
// Additional email addresses that can be used to recover this account, stored on
// the authentik user as `attributes.recovery_emails`.
//
// Adding is verified the same way changing the primary address is (profile.vue +
// backend/routes/email-change.js): this half only requests the addition and
// triggers the confirmation email; the address is added when the recipient opens
// the link, which lands on verify-recovery-email.vue.
definePageMeta({ middleware: 'auth', layout: 'account' })

const { emails, loading, error, removing, max, pending, atCap, load, requestAdd, remove } =
  useRecoveryEmails()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

// Add-address UI state, mirroring the change-email form on the Profile page.
const showAddForm = ref(false)
const newEmail = ref('')
const addError = ref(null)
const sending = ref(false)
const sentTo = ref(null)

// Success banner after the confirmation link is opened (verify-recovery-email.vue
// routes back here with ?added=1).
const justAdded = ref(route.query.added === '1')

// Two-step confirm so a stray click can't drop a way back into the account —
// holds the address awaiting confirmation, or null. Same pattern as the MFA
// page's device removal and Connected Services' disconnect.
const confirming = ref(null)
const actionError = ref(null)

// `autofocus` doesn't fire on an element Vue inserts after page load, so focus the
// field explicitly once it's in the DOM (same reason as FlowExecutor/migrate.vue).
const newEmailInput = ref(null)

async function openAddForm() {
  addError.value = null
  sentTo.value = null
  newEmail.value = ''
  showAddForm.value = true
  await nextTick()
  newEmailInput.value?.focus()
}

function cancelAddForm() {
  showAddForm.value = false
  addError.value = null
}

// Domains no address on an account may sit under (BLOCKED_EMAIL_DOMAINS). The
// backend refuses these on both steps — this only saves the round-trip.
const blockedEmailDomains = useRuntimeConfig().public.blockedEmailDomains ?? []

async function submitAdd() {
  addError.value = null
  const address = newEmail.value.trim()
  const blocked = blockedEmailDomain(address, blockedEmailDomains)
  if (blocked) {
    addError.value = blockedEmailDomainMessage(blocked, 'as a recovery email address')
    return
  }
  sending.value = true
  try {
    sentTo.value = await requestAdd(address)
    showAddForm.value = false
  } catch (e) {
    addError.value =
      e?.data?.error || e?.message || 'Could not send the confirmation link. Please try again.'
  } finally {
    sending.value = false
  }
}

async function onRemove(item) {
  actionError.value = null
  try {
    await remove(item.email)
    confirming.value = null
  } catch (e) {
    actionError.value =
      e?.data?.error ||
      e?.data?.detail ||
      e?.message ||
      'Could not remove that recovery email address.'
  }
}

onMounted(() => {
  if (justAdded.value) {
    // Drop the query param so a refresh doesn't re-show the banner.
    router.replace({ query: {} })
  }
  load()
})
</script>

<template>
  <div>
    <div class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold text-slate-900">Recovery Emails</h1>
        <p class="mt-1 text-sm text-slate-500">
          Additional addresses you can use to get back into your account should you loose access to your primary email address. They cannot be used for login, only for recovery.
        </p>
      </div>
      <!-- Disabled rather than hidden at the cap, so the limit is visible where the
           action is (the note below says why). -->
      <button
        v-if="!showAddForm"
        type="button"
        class="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-sm
          font-semibold text-white shadow-sm transition hover:bg-sky-500
          disabled:cursor-not-allowed disabled:bg-slate-300 disabled:hover:bg-slate-300"
        :disabled="atCap"
        @click="openAddForm"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Add email address
      </button>
    </div>

    <div v-if="justAdded" class="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
      The address has been added to your recovery emails.
    </div>

    <div v-if="atCap" class="mb-4 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
      You've reached the limit of {{ max }} recovery email addresses. Remove one to add another.
    </div>

    <!-- An earlier request still waiting on its link. Only one address can be
         pending at a time, so say which — and that starting another replaces it. -->
    <div
      v-if="pending && !sentTo && !justAdded"
      class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800"
    >
      <span class="font-medium">{{ pending }}</span> is waiting to be confirmed. Open the link we
      emailed to it to finish adding it — adding a different address instead will cancel it.
    </div>

    <!-- "Check your inbox" confirmation after a request is sent. -->
    <div v-if="sentTo" class="mb-4 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
      We've sent a confirmation link to <span class="font-medium">{{ sentTo }}</span>. Open it to
      finish adding it — the address won't be on your recovery list until you do.
    </div>

    <!-- New-address form. Same layout as the change-email form on Profile. -->
    <form
      v-if="showAddForm"
      class="mb-6 space-y-3 border-b border-slate-200 pb-6"
      @submit.prevent="submitAdd"
    >
      <div>
        <label class="field-label" for="new-recovery-email">Recovery email address</label>
        <input
          id="new-recovery-email"
          ref="newEmailInput"
          v-model="newEmail"
          type="email"
          class="field-input"
          autocomplete="email"
          placeholder="you@example.com"
          required
        />
        <p class="mt-1 text-xs text-slate-500">
          We'll send a confirmation link to this address. It's only added to your recovery emails
          once that link is opened and confirmed.
        </p>
        <p v-if="addError" class="mt-1 text-sm text-red-600">{{ addError }}</p>
      </div>
      <div class="flex justify-end gap-3">
        <button
          type="button"
          class="inline-flex items-center justify-center rounded-lg border border-slate-300
            bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition
            hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="sending"
          @click="cancelAddForm"
        >
          Cancel
        </button>
        <button type="submit" class="btn-primary w-auto px-4" :disabled="sending">
          {{ sending ? 'Sending…' : 'Send confirmation link' }}
        </button>
      </div>
    </form>

    <div v-if="actionError" class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ actionError }}
    </div>

    <div v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</div>

    <LoadingState v-else-if="loading" text="Loading your recovery emails…" />

    <div v-else-if="emails.length === 0" class="flex flex-col items-center gap-3 py-12 text-center">
      <!-- Same glyph as this section's sidebar entry (layouts/account.vue), so the
           empty state matches the nav. Lighter stroke at this size. -->
      <LifebuoyMailIcon :stroke-width="1.25" class="h-20 w-20 text-slate-300" />
      <p class="text-sm text-slate-500">You don't have any recovery email addresses yet.</p>
    </div>

    <ul v-else class="space-y-3">
      <li
        v-for="item in emails"
        :key="item.email"
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
              d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
            />
          </svg>
        </span>
        <p class="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{{ item.email }}</p>

        <!-- Two-step confirm: the Remove button swaps for confirm/cancel in place. -->
        <div v-if="confirming === item.email" class="flex shrink-0 items-center gap-2">
          <button
            type="button"
            class="inline-flex shrink-0 items-center justify-center rounded-lg bg-red-600 px-3 py-2
              text-sm font-semibold text-white shadow-sm transition hover:bg-red-500
              disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="removing === item.email"
            @click="onRemove(item)"
          >
            {{ removing === item.email ? 'Removing…' : 'Yes, remove' }}
          </button>
          <button
            type="button"
            class="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-300
              bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition
              hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="removing === item.email"
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
            hover:border-red-300 hover:bg-red-50 hover:text-red-700"
          :aria-label="`Remove ${item.email}`"
          @click="confirming = item.email"
        >
          Remove
        </button>
      </li>
    </ul>

    <p class="mt-6 border-t border-slate-100 pt-4 text-xs text-slate-500">
      Your primary address<span v-if="auth.user?.email"> ({{ auth.user.email }})</span> is managed on
      the <NuxtLink to="/account/profile" class="link">Profile</NuxtLink> page.
    </p>
  </div>
</template>
