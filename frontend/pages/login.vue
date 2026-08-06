<script setup>
// Imported explicitly because it's used through `<component :is>` below: Nuxt's
// components are compile-time auto-imports, not app-level registrations, so a bare
// `:is="'NuxtLink'"` resolves to nothing and renders an inert <nuxtlink> element.
import { NuxtLink } from '#components'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const ak = useAuthentik()

// True while we resolve the session after returning from a social login.
const finalizing = ref(route.query.social === 'return')
// Shown in the footer (which renders in every flow state, including the completed
// one): a social return that didn't resolve, or a completed flow we can't route out
// of — see onComplete.
const signInError = ref(null)

// The sign-up / password-reset links belong beside the sign-in form, so they show on
// the stages that ARE that form and nowhere else: once credentials are in and the
// flow has moved on to verifying identity (MFA), "Stay signed in?" or the closing
// redirect, offering to create an account is noise.
const FORM_STAGES = new Set(['ak-stage-identification', 'ak-stage-password'])

// Legacy Datatracker migration isn't open to the public yet: production shows the
// entry point badged "coming soon" and inert (rendered as a plain div, so there's no
// link to click, middle-click or focus), while dev keeps it a real link so the flow
// stays testable.
const migrateEnabled = import.meta.dev

// A third-party app sent the user here to sign in (authentik redirected its
// /if/flow/<slug>/?client_id=… to us — see the edge rule in README). Resume
// authentik's existing plan and, once done, follow its redirect back to the app.
const isProviderFlow = computed(() => Boolean(route.query.client_id))

async function onComplete(user) {
  if (user) {
    auth.setUser(user)
  } else {
    // The flow finished but didn't tell us who signed in (its /core/users/me/ call
    // failed, or authentik ended a non-applicable flow with a redirect). The browser
    // holds authentik's session cookie either way, so ask the store — this is the
    // same resolve the boot plugin does.
    await auth.fetchSession()
  }
  if (!auth.isAuthenticated) {
    // Never push into a guarded route unauthenticated: the auth middleware bounces
    // to /login — the route we're already on — Vue Router drops that navigation, and
    // the completed flow card stays on screen with nothing said. Say something.
    signInError.value = 'You were signed in, but we could not load your account. Reload this page to continue.'
    return
  }
  router.push('/account/applications')
}

// Coming back from a source (Google/GitHub/Apple) login: authentik has set its
// session cookie on this shared host, so the browser is already authenticated —
// just resolve who signed in. On success we're signed in exactly as if a password
// flow had completed. (This only works in production, where the app and authentik
// share account.ietf.org; it cannot complete against a remote authentik in dev.)
onMounted(async () => {
  // Already signed in (e.g. landing back on /login after a completed login, or a
  // reload): don't present the auth flow again. Re-running it against an
  // authenticated authentik session returns ak-stage-flow-error. Provider (OAuth)
  // flows are the exception — they must proceed so authentik can issue the app's
  // code — so only bounce standalone visits.
  if (auth.isAuthenticated && !isProviderFlow.value) {
    router.replace('/account/applications')
    return
  }
  if (!finalizing.value) {
    return
  }
  try {
    const body = await ak('/core/users/me/')
    const user = body.user ?? body
    if (isAnonymous(user)) {
      throw new Error('Social login did not complete')
    }
    await onComplete(toSessionUser(user))
  } catch (e) {
    signInError.value = e?.data?.detail || 'Social sign-in could not be completed. Please try again.'
    finalizing.value = false
    router.replace({ query: {} })
  }
})
</script>

<template>
  <div v-if="finalizing" class="card">
    <h1 class="mb-1 text-xl font-semibold text-slate-900">Signing you in…</h1>
    <p class="text-sm text-slate-500">Completing your social login.</p>
  </div>

  <FlowExecutor v-else kind="authentication" title="Sign in" :resume="isProviderFlow" @complete="onComplete">
    <template #complete>Signed in — redirecting…</template>
    <template #alternatives>
      <div class="relative">
        <div class="absolute inset-0 flex items-center" aria-hidden="true">
          <div class="w-full border-t border-slate-200" />
        </div>
        <div class="relative flex justify-center">
          <span class="bg-white px-2 text-xs uppercase tracking-wide text-slate-400">
            or migrate from
          </span>
        </div>
      </div>
      <div class="mt-4">
        <component
          :is="migrateEnabled ? NuxtLink : 'div'"
          :to="migrateEnabled ? '/migrate' : undefined"
          class="btn-social w-full"
          :class="migrateEnabled ? '' : 'cursor-default hover:bg-white active:translate-y-0'"
          :aria-disabled="migrateEnabled ? undefined : 'true'"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="h-5 w-5 shrink-0" aria-hidden="true">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
            />
          </svg>
          <span>Legacy Datatracker Account</span>
          <span
            v-if="!migrateEnabled"
            class="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-rose-700"
          >
            Coming soon
          </span>
        </component>
      </div>
    </template>
    <template #footer="{ component }">
      <p v-if="signInError" class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {{ signInError }}
      </p>
      <!-- Only on the sign-in form itself (see FORM_STAGES) — and the divider goes
           with the links, so later stages don't end on a stray rule. -->
      <template v-if="FORM_STAGES.has(component)">
        <hr class="mb-6 border-t border-slate-200" />
        <div class="space-y-1">
          <p>No account? <NuxtLink to="/register" class="link">Create one</NuxtLink></p>
          <p v-if="component === 'ak-stage-password'">
            <NuxtLink to="/recover" class="link">Forgot your password?</NuxtLink>
          </p>
        </div>
      </template>
    </template>
  </FlowExecutor>
</template>
