<script setup>
// Email-confirmation link for a manually created account. authentik's enrollment
// flow (`ietf-enrollment`) sends a verification email whose link points at
// /if/flow/ietf-enrollment/?<token>. A Cloudflare rule sends that here (see README
// "Edge routing"), and we drive the flow through FlowExecutor in RESUME mode,
// forwarding the link's token (the `query`) so authentik restores the pending
// enrollment. It resumes on an interactive ak-stage-consent challenge (authentik's
// generic "confirm to proceed" step — injected on any token resume, not a stage in
// the flow's bindings — with our own copy via the `consent` slot): the token is
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

// The consent stage's copy, naming the address being confirmed. That address is the
// challenge's `pending_user`: authentik puts the pending account's *username* there,
// and this flow's ietf-enrollment-set-username-from-email policy makes the username
// the email address. Dropped from the sentence if it's ever absent.
function confirmCopy(challenge) {
  const email = challenge?.pending_user
  return `Click continue to confirm this email address${email ? ` (${email})` : ''} and finalize your IETF account.`
}

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
    :show-pending-user="false"
    @complete="onComplete"
  >
    <template #consent="{ challenge }">
      <p class="text-sm text-slate-600">{{ confirmCopy(challenge) }}</p>
    </template>
    <template #complete>Your account is ready — redirecting…</template>
  </FlowExecutor>
</template>
