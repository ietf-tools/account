<script setup>
const router = useRouter()

function onComplete() {
  router.push('/login')
}
</script>

<template>
  <FlowExecutor kind="recovery" title="Reset your password" @complete="onComplete">
    <template #complete>Your password has been reset — you can sign in now.</template>
    <template #footer>
      <p>Remembered it? <NuxtLink to="/login" class="link">Back to sign in</NuxtLink></p>
    </template>
  </FlowExecutor>
</template>
