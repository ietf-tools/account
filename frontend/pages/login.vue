<script setup>
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const ak = useAuthentik()

// True while we resolve the session after returning from a social login.
const finalizing = ref(route.query.social === 'return')
const socialError = ref(null)

function onComplete(user) {
  auth.setUser(user)
  router.push('/')
}

// Coming back from a source (Google/GitHub/Apple) login: authentik has set its
// session cookie on this shared host, so the browser is already authenticated —
// just resolve who signed in. On success we're signed in exactly as if a password
// flow had completed. (This only works in production, where the app and authentik
// share account.ietf.org; it cannot complete against a remote authentik in dev.)
onMounted(async () => {
  if (!finalizing.value) {
    return
  }
  try {
    const body = await ak('/core/users/me/')
    const user = body.user ?? body
    if (isAnonymous(user)) {
      throw new Error('Social login did not complete')
    }
    onComplete(toSessionUser(user))
  } catch (e) {
    socialError.value = e?.data?.detail || 'Social sign-in could not be completed. Please try again.'
    finalizing.value = false
    router.replace({ query: {} })
  }
})
</script>

<template>
  <div v-if="finalizing" class="card text-center">
    <h1 class="mb-1 text-xl font-semibold text-slate-900">Signing you in…</h1>
    <p class="text-sm text-slate-500">Completing your social login.</p>
  </div>

  <FlowExecutor v-else kind="authentication" title="Sign in" @complete="onComplete">
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
        <NuxtLink to="/migrate" class="btn-social w-full">
          <span>Legacy Datatracker Account</span>
        </NuxtLink>
      </div>
    </template>
    <template #footer>
      <hr class="mb-6 border-t border-slate-200" />
      <div class="space-y-1">
        <p v-if="socialError" class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {{ socialError }}
        </p>
        <p>No account? <NuxtLink to="/register" class="link">Create one</NuxtLink></p>
        <p><NuxtLink to="/recover" class="link">Forgot your password?</NuxtLink></p>
      </div>
    </template>
  </FlowExecutor>
</template>
