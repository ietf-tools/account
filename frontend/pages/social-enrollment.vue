<script setup>
// First-time social account creation. When a brand-new user returns from a social
// source, authentik runs the source's enrollment flow (`ietf-social-enrollment`)
// to create the account. authentik would render that at
// /if/flow/ietf-social-enrollment/ in its own UI; a Cloudflare rule sends it here
// instead (see README "Edge routing").
//
// Most of the time the flow is non-interactive: the first challenge is already the
// terminal redirect back to `next` (/app/login?social=return, which login.vue turns
// into a resolved session), so all the user sees is the "finalizing" heading flash
// by. But the flow CAN carry interactive stages — the captcha that gates account
// creation — so FlowExecutor drives it (embedded under this page's heading) rather
// than the page GETting the executor once and assuming it's done. RESUME mode: the
// source callback built the plan, and a fresh begin would cancel it.
//
// No auth middleware: the account is still being created. Can't be exercised in
// local dev (the cross-site source cookie won't stick), same as social login.
const auth = useAuthStore()
const router = useRouter()

// Only reached when the flow completes with no redirect for FlowExecutor to follow
// (the normal path is its terminal `to`, back to the `next` the source callback
// started the flow with). The account exists by then, so adopt the session if the
// flow signed the user in, and otherwise hand off to login.vue to finalize it.
function onComplete(user) {
  if (user) {
    auth.setUser(user)
    router.push('/account/applications')
    return
  }
  router.push('/login?social=return')
}
</script>

<template>
  <div class="card text-center">
    <h1 class="mb-6 text-xl font-semibold text-slate-900">Finalizing your account creation</h1>
    <FlowExecutor kind="socialEnrollment" :resume="true" embedded @complete="onComplete">
      <template #complete>Just a moment — redirecting you…</template>
      <template #footer>
        <NuxtLink to="/login" class="link">Back to sign in</NuxtLink>
      </template>
    </FlowExecutor>
  </div>
</template>
