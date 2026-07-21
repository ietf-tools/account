<script setup>
// First-time social account creation. When a brand-new user returns from a social
// source, authentik runs the source's enrollment flow (`ietf-social-enrollment`)
// to create the account. It has no interactive prompt, so authentik would just
// flash its own flow UI at /if/flow/ietf-social-enrollment/ before redirecting. A
// Cloudflare rule sends that here instead (see README "Edge routing").
//
// The flow is non-interactive, so rather than the generic challenge renderer we
// drive it directly and show a friendly "finalizing" screen: resume the plan the
// source callback built (a fresh begin would cancel it), and the first challenge
// is already the terminal redirect back to `next` (/app/login?social=return, which
// login.vue turns into a resolved session).
//
// No auth middleware: the account is still being created. Can't be exercised in
// local dev (the cross-site source cookie won't stick), same as social login.
const ak = useAuthentik()
const runtime = useRuntimeConfig()
const router = useRouter()

const error = ref(null)

const slug = runtime.public.flows.socialEnrollment
const query = import.meta.client ? window.location.search.replace(/^\?/, '') : ''

onMounted(async () => {
  try {
    const challenge = await ak(`/flows/executor/${slug}/?query=${encodeURIComponent(query)}`, {
      method: 'GET'
    })
    // Non-interactive flow: the terminal redirect carries us back to `next`.
    if (isFlowComplete(challenge) && challenge.to) {
      window.location.assign(challenge.to)
      return
    }
    // No redirect target (or an unexpected stage we don't render here): fall back
    // to the login page, which resolves the freshly created session.
    router.push('/login?social=return')
  } catch (e) {
    error.value = e?.data?.detail || e?.message || 'We could not finish creating your account.'
  }
})
</script>

<template>
  <div class="card text-center">
    <h1 class="mb-1 text-xl font-semibold text-slate-900">Finalizing your account creation</h1>
    <template v-if="error">
      <p class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>
      <p class="mt-4 text-sm">
        <NuxtLink to="/login" class="link">Back to sign in</NuxtLink>
      </p>
    </template>
    <template v-else>
      <p class="text-sm text-slate-500">Just a moment — redirecting you…</p>
      <div class="mt-6 flex justify-center">
        <span
          class="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500"
          role="status"
          aria-label="Redirecting"
        />
      </div>
    </template>
  </div>
</template>
