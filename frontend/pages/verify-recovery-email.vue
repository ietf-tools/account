<script setup>
// Recovery-address confirmation link. The backend (routes/recovery-emails.js)
// emails a signed token to the address being ADDED; the link points here at
// /app/verify-recovery-email?token=…. This page is the pre-fetch guard: opening
// the link only *renders* this screen (a bare GET changes nothing), and the
// address is added only when the user clicks Confirm, which POSTs the token back
// to the backend. Because the SPA needs JavaScript to make that call, a mail
// scanner (Outlook, Microsoft Defender) pre-fetching the link can't add anything.
//
// No auth middleware: the token authorises the add, so the link works even on a
// device where the browser isn't signed in — which is the normal case here, since
// the address being confirmed usually isn't the one the account signs in with.
const route = useRoute()
const router = useRouter()
const api = useApi()

const token = String(route.query.token ?? '')
const state = ref(token ? 'confirm' : 'invalid') // confirm | working | done | invalid | error
const errorMessage = ref('')

async function confirm() {
  state.value = 'working'
  errorMessage.value = ''
  try {
    await api('/recovery-emails/verify', { method: 'POST', body: { token } })
    state.value = 'done'
    // Brief success beat, then hand off to the section's own banner. That route is
    // guarded, so an unauthenticated browser lands on sign-in — the add is already
    // applied either way.
    setTimeout(() => router.push('/account/recovery-emails?added=1'), 1200)
  } catch (e) {
    errorMessage.value =
      e?.data?.error || e?.message || 'We could not confirm this recovery email address.'
    state.value = 'error'
  }
}
</script>

<template>
  <div class="card">
    <h1 class="mb-1 text-xl font-semibold text-slate-900">Confirm your recovery email address</h1>

    <div v-if="state === 'invalid'" class="mt-4 text-sm text-slate-600">
      <p>
        This confirmation link is missing or invalid. Please start again from your account's
        recovery emails.
      </p>
      <NuxtLink to="/account/recovery-emails" class="link mt-3 inline-block">
        Back to recovery emails
      </NuxtLink>
    </div>

    <template v-else-if="state === 'confirm' || state === 'working'">
      <p class="mt-2 mb-6 text-sm text-slate-500">
        Click confirm to add this address to your IETF account's recovery emails. It can be used to
        get back into the account if you lose access to your primary email address, and cannot be
        used to sign in.
      </p>
      <button type="button" class="btn-primary" :disabled="state === 'working'" @click="confirm">
        {{ state === 'working' ? 'Confirming…' : 'Confirm recovery email' }}
      </button>
    </template>

    <div v-else-if="state === 'done'" class="mt-4 text-sm text-slate-600">
      This address has been added to your recovery emails — redirecting…
    </div>

    <div v-else-if="state === 'error'" class="mt-4">
      <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ errorMessage }}</p>
      <NuxtLink to="/account/recovery-emails" class="link mt-3 inline-block">
        Back to recovery emails
      </NuxtLink>
    </div>
  </div>
</template>
