<script setup>
// Landing for an app's OIDC logout. authentik's provider builds an invalidation
// flow plan bound to the app and 302s the browser to
// /if/flow/ietf-provider-invalidation-flow/?…; a Cloudflare rule rewrites that to
// /app/logout?… (see README "Edge routing"). We drive that flow through the
// executor in RESUME mode — cancelling would drop the app context authentik put
// in the plan — and it ends on an ak-stage-session-end challenge, which
// FlowExecutor renders as the "signed out of <app>" screen.
//
// This flow never reaches xak-flow-redirect (session-end is its terminal stage),
// so `complete` never fires; the on-screen options are plain navigations. No auth
// middleware: the user is mid-logout and may or may not still have a session.
</script>

<template>
  <FlowExecutor kind="providerInvalidation" title="Signed out" :resume="true" />
</template>
