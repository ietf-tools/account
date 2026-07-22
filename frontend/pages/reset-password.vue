<script setup>
// Password-reset link for the "forgot password" flow (`ietf-recovery`). authentik's
// recovery email stage sends a link pointing at /if/flow/ietf-recovery/?<token>. A
// Cloudflare rule sends that here (see README "Edge routing"), and we drive the flow
// through FlowExecutor in RESUME mode, forwarding the link's token (the preserved
// `query`) so authentik restores the pending recovery and renders the "set a new
// password" stage (an `ak-stage-prompt` carrying the password fields) in our own UI
// instead of authentik's native flow view.
//
// The email-entry step of the same flow is driven separately by recover.vue; this
// page only handles the mid-flow resume the email link lands on. The token is
// consumed only as the flow advances on the prompt's POST, and this SPA needs
// JavaScript to call the executor at all, so a link pre-fetch (Outlook, Defender)
// that doesn't run JS never reaches authentik.
//
// The recovery flow ends on a User Login stage, so completion leaves the browser
// signed in. We opt out of following authentik's terminal redirect
// (`:follow-redirect="false"` — its `to` only points into authentik's own user UI),
// resolve our own session, and route into the signed-in area (falling back to
// sign-in if the flow didn't authenticate).
//
// No auth middleware: the user is resetting their password, not yet signed in.
const auth = useAuthStore()
const router = useRouter()

async function onComplete() {
  // Re-resolve from /core/users/me/ so isAuthenticated reflects the login the flow
  // just performed.
  await auth.fetchSession()
  router.push(auth.isAuthenticated ? '/account/applications' : '/login')
}
</script>

<template>
  <FlowExecutor
    kind="recovery"
    title="Choose a new password"
    :resume="true"
    :follow-redirect="false"
    @complete="onComplete"
  >
    <template #complete>Your password has been reset — redirecting…</template>
    <template #footer>
      <p>Remembered it? <NuxtLink to="/login" class="link">Back to sign in</NuxtLink></p>
    </template>
  </FlowExecutor>
</template>
