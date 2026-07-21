<script setup>
// Interactive return from a social/OAuth source. authentik runs the source's
// callback flow (`ietf-social-callback`) after the provider round-trip. It usually
// completes non-interactively and redirects straight to `next`
// (/app/login?social=return, which login.vue finalizes) — but when it needs
// interactive stages (first-time enrollment, account linking, missing attributes)
// authentik would otherwise render its own UI at /if/flow/ietf-social-callback/.
// A Cloudflare rule sends that here instead (see README "Edge routing").
//
// We drive the flow through FlowExecutor in RESUME mode: the source callback built
// the plan in authentik's session, so cancelling it (a fresh begin) would discard
// the in-progress social login. On completion the flow redirects to the `next` it
// was started with — FlowExecutor follows that full-page, landing on
// /app/login?social=return where login.vue resolves the session. The no-`next`
// fallback resolves here instead.
//
// No auth middleware: the user isn't signed in yet. Can't be exercised in local
// dev (the cross-site source cookie won't stick), same as the rest of social login.
const auth = useAuthStore()
const router = useRouter()

function onComplete(user) {
  if (user) {
    auth.setUser(user)
  }
  router.push('/account/applications')
}
</script>

<template>
  <FlowExecutor kind="socialCallback" title="Complete your sign-in" :resume="true" @complete="onComplete">
    <template #complete>Signed in — redirecting…</template>
  </FlowExecutor>
</template>
