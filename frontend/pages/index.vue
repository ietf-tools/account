<script setup>
// The signed-in home is the account shell; there's no standalone landing page.
// Guard for auth, then send the user to the default section. Doing the redirect
// in middleware (before render) avoids a flash of empty content.
definePageMeta({
  middleware: ['auth', () => navigateTo('/account/applications')]
})
</script>

<template>
  <div />
</template>
