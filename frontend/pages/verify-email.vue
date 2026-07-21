<script setup>
// Email-confirmation link for a manually created account. authentik's enrollment
// flow (`ietf-enrollment`) sends a verification email whose link points at
// /if/flow/ietf-enrollment/?<token>. A Cloudflare rule sends that here (see README
// "Edge routing"), and we drive the flow through FlowExecutor in RESUME mode,
// forwarding the link's token (the `query`) so authentik restores the pending
// enrollment. It resumes on an interactive consent stage (authentik's generic
// "confirm to proceed" step, with our own copy via `consent-text`): the token is
// only consumed when the user submits (POST), so an email client pre-fetching
// the link (Outlook, Defender) can't verify the account on the user's behalf — and
// because this SPA needs JavaScript to call the executor at all, a plain link
// pre-fetch (which doesn't run JS) never even reaches authentik.
//
// The flow ends on a User Login stage, so completion leaves the browser signed in.
// We opt out of following authentik's terminal redirect (`:follow-redirect="false"`
// — its `to` only points into authentik's own user UI) and instead resolve our own
// session and route into the signed-in area, falling back to sign-in if the flow
// didn't authenticate.
//
// No auth middleware: the account is being confirmed, not yet signed in.
const auth = useAuthStore()
const router = useRouter()

async function onComplete() {
  // Re-resolve from /core/users/me/ (this also filters authentik's AnonymousUser),
  // so isAuthenticated reflects the login the flow just performed.
  await auth.fetchSession()
  router.push(auth.isAuthenticated ? '/account/applications' : '/login')
}
</script>

<template>
  <FlowExecutor
    kind="enrollment"
    title="Finalize your account"
    :resume="true"
    :follow-redirect="false"
    consent-text="Click continue to confirm this email address and finalize your IETF account."
    @complete="onComplete"
  >
    <template #complete>Your account is ready — redirecting…</template>
    <template #footer>
      <p>Changed your mind? <NuxtLink to="/login" class="link">Back to sign in</NuxtLink></p>
    </template>
  </FlowExecutor>
</template>
