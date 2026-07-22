<script setup>
// Landing for a third-party app's OAuth/OIDC authorization. authentik is an
// OAuth provider: an app sends the user to /application/o/authorize/?client_id=…
// to authorize access. Once the user is authenticated (the login flow runs first
// otherwise — intercepted at /app/login), authentik runs the provider's
// *authorization* flow (`ietf-provider-authorization`) to grant access and issue
// the app its code. With implicit consent it's non-interactive — the first
// challenge is already the terminal redirect back to the app — so all the user
// sees is a brief "redirecting" screen; explicit-consent providers add an
// ak-stage-consent stage, which FlowExecutor renders. authentik would otherwise
// show its stock flow UI at /if/flow/ietf-provider-authorization/; a Cloudflare
// rule sends that here instead (see README "Edge routing").
//
// Driven in RESUME mode: the authorize endpoint built the flow plan (carrying the
// OAuth request) in authentik's session, so a fresh begin would cancel it and the
// app would never get its code. On completion FlowExecutor follows authentik's
// terminal redirect (xak-flow-redirect → `to`) full-page back to the app.
//
// No auth middleware: authentik guarantees the user is authenticated before this
// flow runs. Can't be exercised in local dev (authentik is remote) — verify
// against a same-host deployment with a real OAuth client.
</script>

<template>
  <FlowExecutor kind="providerAuthorization" title="Redirecting…" :resume="true">
    <template #complete>Redirecting you to the application…</template>
  </FlowExecutor>
</template>
