<script setup>
// Email-change confirmation link. authentik's change-email flow
// (`ietf-email-change`) sends a verification email to the NEW address, whose link
// points at /if/flow/ietf-email-change/?<token>. A Cloudflare rule sends that here
// (see README "Edge routing"), and we drive the flow through FlowExecutor in
// RESUME mode, forwarding the link's token (the preserved `query`) so authentik
// restores the pending change and renders the confirmation.
//
// The address-entry step of the same flow is driven separately by the embedded
// FlowExecutor on account/profile.vue; this page only handles the mid-flow resume
// the email link lands on. Like enrollment (and unlike recovery) the resume guard
// is exactly the protection we want: authentik injects an interactive
// ak-stage-consent on token resume, the token is consumed only on the user's POST,
// and this SPA needs JavaScript to call the executor at all — so an email client
// pre-fetching the link (Outlook, Microsoft Defender) can't confirm the change on
// the user's behalf, and a plain link pre-fetch (which doesn't run JS) never even
// reaches authentik. Hence NO `:auto-consent` here — the click must stay explicit.
//
// The change-email flow has no User Login stage (the user is already signed in), so
// we opt out of authentik's terminal redirect (`:follow-redirect="false"` — its `to`
// only points into authentik's own user UI), resolve our own session, and route to
// the profile page (falling back to sign-in if the browser wasn't authenticated —
// e.g. the link was opened on a different device).
const auth = useAuthStore()
const router = useRouter()

async function onComplete() {
  // Re-resolve from /core/users/me/ so the store (and the sidebar) reflect the new
  // email/username the flow just wrote.
  await auth.fetchSession()
  router.push(auth.isAuthenticated ? '/account/profile' : '/login')
}
</script>

<template>
  <FlowExecutor
    kind="emailChange"
    title="Confirm your new email address"
    :resume="true"
    :follow-redirect="false"
    consent-text="Click continue to confirm this email address for your IETF account."
    @complete="onComplete"
  >
    <template #complete>Your email address has been updated — redirecting…</template>
    <template #footer>
      <p>Not you? <NuxtLink to="/login" class="link">Back to sign in</NuxtLink></p>
    </template>
  </FlowExecutor>
</template>
