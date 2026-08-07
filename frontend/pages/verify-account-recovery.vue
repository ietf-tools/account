<script setup>
// Step 2+3 of account recovery. The backend mails a signed token to a confirmed
// recovery address; the link points here at /app/verify-account-recovery?token=….
//
// Pre-fetch guard, same as the other mailed links: opening the URL only *reads*
// (POST /options) and renders this form. Nothing changes until the user submits,
// and the SPA needs JavaScript to submit — so a mail scanner (Outlook, Microsoft
// Defender) following the link can't recover anyone's account.
//
// No auth middleware: there is no session by definition — losing access to the
// account is why someone is here. The token is the authorisation.
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { loadOptions, complete } = useAccountRecovery()

const token = String(route.query.token ?? '')
// loading | choose | working | done | invalid | error
const state = ref(token ? 'loading' : 'invalid')
const errorMessage = ref('')

const account = ref('')
const emails = ref([])
const minPasswordLength = ref(8)

const chosen = ref('')
const password = ref('')
const confirmPassword = ref('')
const formError = ref(null)

function validate() {
  formError.value = null
  if (!chosen.value) {
    formError.value = 'Choose which address should become your account email.'
  } else if (password.value.length < minPasswordLength.value) {
    formError.value = `Your new password must be at least ${minPasswordLength.value} characters.`
  } else if (password.value !== confirmPassword.value) {
    formError.value = "Those passwords don't match."
  }
  return !formError.value
}

async function onSubmit() {
  if (!validate()) {
    return
  }
  const previous = state.value
  state.value = 'working'
  try {
    await complete({ token, email: chosen.value, password: password.value })
    state.value = 'done'
    // The account is changed, but this browser has no authentik session — recovery
    // starts from "I can't sign in".
    await auth.fetchSession().catch(() => {})
    setTimeout(() => router.push('/'), 2000)
  } catch (e) {
    formError.value =
      e?.data?.error || e?.data?.message || e?.message || 'We could not recover this account.'
    state.value = previous
  }
}

onMounted(async () => {
  if (!token) {
    return
  }
  try {
    const options = await loadOptions(token)
    account.value = options?.account ?? ''
    emails.value = Array.isArray(options?.emails) ? options.emails : []
    minPasswordLength.value = Number(options?.minPasswordLength) || 8
    if (!emails.value.length) {
      // Can't happen from a link we minted (it needs a confirmed address), but the
      // list could have been emptied since. Don't render an unanswerable form.
      state.value = 'error'
      errorMessage.value =
        'There are no recovery email addresses left on this account. Please contact support@ietf.org.'
      return
    }
    // Preselect the address the link was sent to — the one we know they can read.
    chosen.value =
      emails.value.find((item) => item.email === options?.sentTo)?.email || emails.value[0].email
    state.value = 'choose'
  } catch (e) {
    errorMessage.value =
      e?.data?.error ||
      e?.data?.message ||
      e?.message ||
      'This recovery link is invalid, already used, or has expired.'
    state.value = 'invalid'
  }
})
</script>

<template>
  <div class="card">
    <h1 class="mb-1 text-xl font-semibold text-slate-900">Recover your account</h1>

    <LoadingState v-if="state === 'loading'" text="Checking your recovery link…" />

    <div v-else-if="state === 'invalid'" class="mt-4 text-sm text-slate-600">
      <p>{{ errorMessage || 'This recovery link is missing or invalid.' }}</p>
      <NuxtLink to="/recover-account" class="link mt-3 inline-block">Start again</NuxtLink>
    </div>

    <div v-else-if="state === 'error'" class="mt-4">
      <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ errorMessage }}</p>
      <NuxtLink to="/login" class="link mt-3 inline-block">Back to sign in</NuxtLink>
    </div>

    <div v-else-if="state === 'done'" class="mt-4 text-sm text-slate-600">
      Your account now uses <span class="font-medium text-slate-900">{{ chosen }}</span> and your
      new password — redirecting to the login page…
    </div>

    <template v-else>
      <p class="mt-2 text-sm text-slate-500">
        Choose the address this account should use from now on, and set a new password.
      </p>

      <form class="mt-6 space-y-4" @submit.prevent="onSubmit">
        <fieldset>
          <legend class="field-label">New account email address</legend>
          <div class="mt-1 space-y-2">
            <label
              v-for="item in emails"
              :key="item.email"
              class="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition"
              :class="
                chosen === item.email
                  ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-500'
                  : 'border-slate-300 hover:bg-slate-50'
              "
            >
              <input v-model="chosen" type="radio" :value="item.email" class="accent-sky-600" />
              <span class="min-w-0 truncate font-medium text-slate-900">{{ item.email }}</span>
            </label>
          </div>
          <p class="mt-1 text-xs text-slate-500">
            This becomes your account new primary email address for sign-in.
            <span v-if="account">
              The account's current address ({{ account }}) will no longer work.
            </span>
          </p>
        </fieldset>

        <div>
          <label class="field-label" for="new-password">New password</label>
          <input
            id="new-password"
            v-model="password"
            type="password"
            class="field-input"
            autocomplete="new-password"
          />
          <p class="mt-1 text-xs text-slate-500">
            At least {{ minPasswordLength }} characters.
          </p>
        </div>

        <div>
          <label class="field-label" for="confirm-password">Confirm new password</label>
          <input
            id="confirm-password"
            v-model="confirmPassword"
            type="password"
            class="field-input"
            autocomplete="new-password"
          />
        </div>

        <p v-if="formError" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {{ formError }}
        </p>

        <button type="submit" class="btn-primary" :disabled="state === 'working'">
          {{ state === 'working' ? 'Recovering…' : 'Recover account' }}
        </button>
      </form>
    </template>
  </div>
</template>
