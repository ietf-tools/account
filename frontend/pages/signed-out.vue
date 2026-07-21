<script setup>
// The brand's actual sign-out (the `invalidation` flow) rendered in-app instead
// of authentik's native flow UI. Reached from three places, all funnelled here so
// logout has one look:
//   - the account shell's "Sign out" (layouts/account.vue),
//   - the provider session-end screen's "Sign out of IETF Account entirely"
//     button (FlowExecutor.vue), and
//   - any direct hit to /if/flow/ietf-invalidation/ (via a Cloudflare rule; see
//     README "Edge routing").
//
// The invalidation flow is a user_logout stage, so FlowExecutor GETs the executor,
// authentik ends the session, and the flow completes immediately with no
// interactive stage. On completion we drop the local session record and show a
// confirmation. No auth middleware — the visitor is signing out (or already out).
const auth = useAuthStore()

function onDone() {
  // Whoever the executor resolved on completion is now anonymous — clear the
  // local record so the app (and its route guard) sees us as signed out.
  auth.setUser(null)
}
</script>

<template>
  <FlowExecutor kind="invalidation" title="Sign out" @complete="onDone">
    <template #complete>
      <p>You've been signed out of your IETF Account.</p>
      <p class="mt-4">
        <NuxtLink to="/login" class="link">Sign in again</NuxtLink>
      </p>
    </template>
  </FlowExecutor>
</template>
