<script setup>
// Step 1 of account recovery: name a recovery address and get a link mailed to it.
// Reached from the "Recover an account" button under the password form on
// login.vue, which passes along who we were signing in as (?account=…).
//
// Distinct from /recover, which is authentik's password reset and only helps if
// the primary address still works. See backend/routes/account-recovery.js.
const route = useRoute()
const { requestLink } = useAccountRecovery()

// Who the sign-in attempt was for. Absent if someone lands here directly, in which
// case we have to ask — the backend needs to know which account to look at.
const account = ref(String(route.query.account ?? '').trim())
const knownAccount = account.value

const recovery = ref('')
const recoveryInput = ref(null)
const accountError = ref(null)
const recoveryError = ref(null)
const sending = ref(false)
// Set once the request goes through. The backend answers identically whether or
// not anything matched, so this is deliberately not a "we found it" signal.
const requested = ref(false)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validate() {
  accountError.value = null
  recoveryError.value = null
  if (!account.value.trim()) {
    accountError.value = "Please enter your account's email address."
  }
  if (!recovery.value.trim()) {
    recoveryError.value = 'Please enter one of your recovery email addresses.'
  } else if (!EMAIL_RE.test(recovery.value.trim())) {
    recoveryError.value = 'Please enter a valid email address.'
  }
  return !accountError.value && !recoveryError.value
}

async function onSubmit() {
  if (!validate()) {
    return
  }
  sending.value = true
  try {
    await requestLink({ account: account.value.trim(), recovery: recovery.value.trim() })
    requested.value = true
  } catch (e) {
    recoveryError.value =
      e?.data?.error || e?.data?.message || e?.message || 'Something went wrong. Please try again.'
  } finally {
    sending.value = false
  }
}

// `autofocus` doesn't fire on SPA navigation — focus explicitly.
onMounted(() => {
  recoveryInput.value?.focus()
})
</script>

<template>
  <div class="card">
    <h1 class="mb-1 text-xl font-semibold text-slate-900">Recover an account</h1>
    <p class="text-sm text-slate-500">
      For when you can't sign in and no longer have access to your account's primary email
      address<span v-if="knownAccount"> ({{ knownAccount }})</span>.
    </p>

    <!-- Deliberately says nothing about whether the address matched: the backend
         doesn't tell us, so that this page can't be used to test whether an address
         belongs to an account. -->
    <div v-if="requested" class="mt-6">
      <div class="rounded-lg bg-sky-50 px-3 py-3 text-sm text-sky-800">
        <p class="font-medium">Check that inbox.</p>
        <p class="mt-1">
          If <span class="font-medium">{{ recovery }}</span> is a confirmed recovery address on
          that account, we've sent it a link to recover it. The link is valid for 30 minutes.
        </p>
      </div>
      <p class="mt-4 text-sm text-slate-500">
        Nothing arrived? Check the spam folder, or
        <button type="button" class="link" @click="requested = false">try another address</button>.
      </p>
    </div>

    <form v-else class="mt-6 space-y-4" @submit.prevent="onSubmit">
      <!-- Only asked for when we weren't told (someone came here directly rather
           than from the sign-in form). -->
      <div v-if="!knownAccount">
        <label class="field-label" for="account-email">Your account's email address</label>
        <input
          id="account-email"
          v-model="account"
          type="email"
          class="field-input"
          autocomplete="username"
          placeholder="you@example.com"
        />
        <p v-if="accountError" class="mt-1 text-sm text-red-600">{{ accountError }}</p>
      </div>

      <div>
        <label class="field-label" for="recovery-email">Recovery email address</label>
        <input
          id="recovery-email"
          ref="recoveryInput"
          v-model="recovery"
          type="email"
          class="field-input"
          autocomplete="email"
          placeholder="backup@example.com"
        />
        <p class="mt-1 text-xs text-slate-500">
          One of the recovery addresses confirmed on the account. We'll email it a link to
          recover the account — nothing changes until you open it.
        </p>
        <p v-if="recoveryError" class="mt-1 text-sm text-red-600">{{ recoveryError }}</p>
      </div>

      <button type="submit" class="btn-primary" :disabled="sending">
        {{ sending ? 'Sending…' : 'Continue' }}
      </button>
    </form>

    <div class="mt-6 text-sm text-slate-500">
      <p>
        Still have access to your email?
        <NuxtLink to="/recover" class="link">Reset your password</NuxtLink> instead.
      </p>
      <!-- Set off from the suggestion above: this one's just the way out, not
           another thing to try. -->
      <p class="mt-4"><NuxtLink to="/login" class="link">Back to sign in</NuxtLink></p>
    </div>
  </div>
</template>
