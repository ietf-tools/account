<script setup>
const auth = useAuthStore()
const router = useRouter()

function onComplete(user) {
  // Enrollment flows may or may not log the user in automatically depending on
  // your flow config. If they did, `user` is populated; otherwise send them to
  // sign in.
  if (user) {
    auth.setUser(user)
    router.push('/')
  } else {
    router.push('/login')
  }
}
</script>

<template>
  <FlowExecutor kind="enrollment" title="Create your account" @complete="onComplete">
    <template #complete>Account created — redirecting…</template>
    <template #footer>
      <p>Already have an account? <NuxtLink to="/login" class="link">Sign in</NuxtLink></p>
    </template>
  </FlowExecutor>
</template>
