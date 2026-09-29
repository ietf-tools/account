<script setup>
const auth = useAuthStore()
const router = useRouter()

// The enrollment flow is `require_unauthenticated`: started with a live session,
// authentik answers with a bare "Flow does not apply to current user." So a visitor
// who's already signed in (typically a third-party app's "Create an account" link)
// gets the AlreadySignedIn card instead, and the flow never begins. Read once, not
// reactively: onComplete below signs the new user in, and that must not swap the
// card in over the "redirecting" message.
const signedInOnArrival = auth.isAuthenticated

function onComplete(user) {
  // Enrollment flows may or may not log the user in automatically depending on
  // your flow config. If they did, `user` is populated; otherwise send them to
  // sign in.
  if (user) {
    auth.setUser(user)
    router.push('/account/applications')
  } else {
    router.push('/login')
  }
}

// "Already have an account? Sign in" belongs on the sign-up form itself. Past it —
// the Note Well agreement, the captcha, then the "check your inbox" step (by which
// point the account exists) — the user is part-way through creating an account, so
// the link is only a way to lose that progress. The agreement is an ak-stage-prompt
// like the form, so it's told apart by its field key (see
// authentik/ietf-flows/ietf-note-well-consent.yaml).
const NO_SIGN_IN_STAGES = new Set(['ak-stage-captcha', 'ak-stage-email'])

function showSignIn(component, challenge) {
  if (NO_SIGN_IN_STAGES.has(component)) {
    return false
  }
  if (component === 'ak-stage-prompt') {
    return !(challenge?.fields ?? []).some((field) => field.field_key === 'note_well_agreed')
  }
  return true
}
</script>

<template>
  <AlreadySignedIn v-if="signedInOnArrival" />
  <FlowExecutor
    v-else
    kind="enrollment"
    title="Create your account"
    :stage-titles="{ 'ak-stage-email': 'Email Verification' }"
    @complete="onComplete"
  >
    <template #complete>Account created — redirecting…</template>
    <template #footer="{ component, challenge }">
      <p v-if="showSignIn(component, challenge)">
        Already have an account? <NuxtLink to="/login" class="link">Sign in</NuxtLink>
      </p>
    </template>
  </FlowExecutor>
</template>
