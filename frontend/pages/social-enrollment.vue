<script setup>
// First-time social account creation. When a brand-new user returns from a social
// source, authentik runs the source's enrollment flow (`ietf-social-enrollment`)
// to create the account. authentik would render that at
// /if/flow/ietf-social-enrollment/ in its own UI; a Cloudflare rule sends it here
// instead (see README "Edge routing").
//
// The flow carries interactive stages — the Note Well agreement and the captcha
// that gate account creation — so FlowExecutor drives it (embedded under this
// page's heading) rather than the page GETting the executor once and assuming it's
// done. RESUME mode: the source callback built the plan, and a fresh begin would
// cancel it. Strip those stages back out of the flow and it goes non-interactive
// again: the first challenge is then already the terminal redirect back to `next`
// (/app/login?social=return, which login.vue turns into a resolved session), and
// all the user sees is this heading flashing by.
//
// No auth middleware: the account is still being created. Can't be exercised in
// local dev (the cross-site source cookie won't stick), same as social login.
const auth = useAuthStore()
const router = useRouter()

// The flow drives this page's chrome, since FlowExecutor is embedded here and renders
// none of its own: `stage` is the component of the challenge on screen.
const stage = ref(null)

// The "Stay signed in?" card asks its own question, so it gets its own heading (the
// same swap FlowExecutor makes for that stage when it owns the header).
const heading = computed(() => {
  return stage.value === 'ak-stage-user-login' ? 'Stay signed in?' : 'Finish setting up your account'
})

// "Back to sign in" is an out worth offering while the flow is still asking for
// something the user could walk away from — the Note Well agreement — and on a
// dead-end stage like access-denied. Not on the captcha, the stay-signed-in card or
// the closing redirect: the account is being created by then, so leaving mid-way
// isn't a useful suggestion. Nor before the first challenge arrives.
const NO_FOOTER_STAGES = new Set(['ak-stage-captcha', 'ak-stage-user-login', 'xak-flow-redirect'])
const showBackToSignIn = computed(() => {
  return Boolean(stage.value) && !NO_FOOTER_STAGES.has(stage.value)
})

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
    <!-- Reads for both faces of this page: the agreement/captcha stages the flow
         renders here, and the redirect-only pass where it just flashes by. -->
    <h1 class="mb-6 text-xl font-semibold text-slate-900">{{ heading }}</h1>
    <FlowExecutor
      kind="socialEnrollment"
      :resume="true"
      embedded
      @stage="stage = $event"
      @complete="onComplete"
    >
      <template #complete>Just a moment — redirecting you…</template>
      <template #footer>
        <NuxtLink v-if="showBackToSignIn" to="/login" class="link">Back to sign in</NuxtLink>
      </template>
    </FlowExecutor>
  </div>
</template>
