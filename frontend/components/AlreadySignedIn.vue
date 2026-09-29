<script setup>
// Shown in place of a flow that only applies to signed-out visitors (enrollment)
// when the browser already holds an authentik session. authentik would otherwise
// refuse the flow — its `require_unauthenticated` check ends it on a bare
// "Flow does not apply to current user." access-denied screen — so the host page
// renders this instead of FlowExecutor. It's reached mainly from third-party apps
// linking straight to sign-up (/if/flow/ietf-enrollment/, routed here by the
// Cloudflare rule — see verify-email.vue) for a user who's already signed in.
//
// "Continue" follows the link's `next` when it stays on this origin (e.g.
// /application/o/authorize/?client_id=… — authentik then signs the user in to that
// app with the existing session, no form), else lands in the account shell. The
// origin check keeps this from being an open redirect. "Sign out" hands over to
// /signed-out, which comes back to `signOutTo` once the session is gone.
const props = defineProps({
  title: { type: String, default: "You're already signed in" },
  // Where the sign-out button returns to (a /signed-out `redirect` key).
  signOutTo: { type: String, default: 'register' },
  signOutLabel: { type: String, default: 'Sign out and create a new account' }
})

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const displayName = computed(() => auth.user?.name || auth.user?.username || '')
const email = computed(() => (auth.user?.email && auth.user.email !== displayName.value ? auth.user.email : ''))

// The link's `next`, if it points back into this origin; null otherwise.
const nextUrl = computed(() => {
  const raw = typeof route.query.next === 'string' ? route.query.next : ''
  if (!raw) {
    return null
  }
  try {
    const url = new URL(raw, window.location.origin)
    return url.origin === window.location.origin ? url.toString() : null
  } catch {
    return null
  }
})

function onContinue() {
  if (nextUrl.value) {
    // Full-page: `next` is usually an authentik path, not a route in this SPA.
    window.location.assign(nextUrl.value)
  } else {
    router.push('/account/applications')
  }
}

function onSignOut() {
  router.push({ path: '/signed-out', query: { redirect: props.signOutTo } })
}
</script>

<template>
  <div class="card">
    <h1 class="mb-6 text-xl font-semibold text-slate-900">{{ title }}</h1>

    <div class="mb-6 flex items-center gap-3">
      <img
        v-if="auth.user?.avatar"
        :src="auth.user.avatar"
        alt=""
        class="h-12 w-12 flex-none rounded-full bg-slate-100 object-cover"
      />
      <p class="min-w-0 text-sm text-slate-600">
        You're signed in to your IETF Account as
        <span class="font-medium text-slate-900">{{ displayName }}</span><template v-if="email">
          (<span class="break-all">{{ email }}</span>)</template>.
      </p>
    </div>

    <div class="space-y-3">
      <button type="button" class="btn-primary" @click="onContinue">
        {{ nextUrl ? 'Continue' : 'Continue to your account' }}
      </button>
      <button type="button" class="btn-social w-full justify-center" @click="onSignOut">
        {{ signOutLabel }}
      </button>
    </div>
  </div>
</template>
