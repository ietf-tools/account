<script setup>
// Email-confirmation link for a manually created account. authentik's enrollment
// flow (`ietf-enrollment`) sends a verification email whose link points at
// /if/flow/ietf-enrollment/?<token>. A Cloudflare rule sends that here (see README
// "Edge routing"), and we drive the flow through FlowExecutor in RESUME mode,
// forwarding the link's token (the `query`) so authentik restores the pending
// enrollment. It resumes on an interactive "Confirm" stage (a prompt): the token
// is only consumed when the user submits (POST), so an email client pre-fetching
// the link (Outlook, Defender) can't verify the account on the user's behalf — and
// because this SPA needs JavaScript to call the executor at all, a plain link
// pre-fetch (which doesn't run JS) never even reaches authentik. On completion the
// flow follows its own terminal redirect; if it has none, the fallback below
// signs the user in (if the flow auto-authenticated) or sends them to sign in.
//
// No auth middleware: the account is being confirmed, not yet signed in.
const auth = useAuthStore()
const router = useRouter()

function onComplete(user) {
  if (user) {
    auth.setUser(user)
    router.push('/account/applications')
  } else {
    router.push('/login')
  }
}
</script>

<template>
  <FlowExecutor kind="enrollment" title="Confirm your email address" :resume="true" @complete="onComplete">
    <template #complete>Your email address is confirmed — you can sign in now.</template>
    <template #footer>
      <p>Changed your mind? <NuxtLink to="/login" class="link">Back to sign in</NuxtLink></p>
    </template>
  </FlowExecutor>
</template>
