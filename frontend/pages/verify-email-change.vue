<script setup>
// Email-change confirmation link. The backend (routes/email-change.ts) emails a
// signed token to the NEW address; the link points here at
// /app/verify-email-change?token=…. This page is the pre-fetch guard: opening the
// link only *renders* this screen (a bare GET changes nothing), and the change is
// applied only when the user clicks Confirm, which POSTs the token back to the
// backend. Because the SPA needs JavaScript to make that call, a mail scanner
// (Outlook, Microsoft Defender) pre-fetching the link can't confirm the change.
//
// No auth middleware: the token authorises the change, so the link works even on
// a device where the browser isn't signed in. On success we send the user to the
// profile page (which will bounce to sign-in if they're not authenticated there).
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
    await api('/email-change/verify', { method: 'POST', body: { token } })
    state.value = 'done'
    // Brief success beat, then hand off to the profile page's own banner.
    setTimeout(() => router.push('/account/profile?changed=1'), 1200)
  } catch (e) {
    errorMessage.value = e?.data?.error || e?.message || 'We could not confirm this email change.'
    state.value = 'error'
  }
}
</script>

<template>
  <div class="card">
    <h1 class="mb-1 text-xl font-semibold text-slate-900">Confirm your new email address</h1>

    <div v-if="state === 'invalid'" class="mt-4 text-sm text-slate-600">
      <p>This confirmation link is missing or invalid. Please start the change again from your profile.</p>
      <NuxtLink to="/account/profile" class="link mt-3 inline-block">Back to profile</NuxtLink>
    </div>

    <template v-else-if="state === 'confirm' || state === 'working'">
      <p class="mt-2 mb-6 text-sm text-slate-500">
        Click confirm to set this as the email address (and sign-in) for your IETF account.
      </p>
      <button type="button" class="btn-primary" :disabled="state === 'working'" @click="confirm">
        {{ state === 'working' ? 'Confirming…' : 'Confirm email change' }}
      </button>
    </template>

    <div v-else-if="state === 'done'" class="mt-4 text-sm text-slate-600">
      Your email address has been updated — redirecting…
    </div>

    <div v-else-if="state === 'error'" class="mt-4">
      <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ errorMessage }}</p>
      <NuxtLink to="/account/profile" class="link mt-3 inline-block">Back to profile</NuxtLink>
    </div>
  </div>
</template>
