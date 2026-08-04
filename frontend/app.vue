<script setup>
// Import the icon through Vite so it gets a hashed, base-prefixed (/app/) URL
// rather than a raw path that wouldn't resolve at runtime.
import faviconUrl from '~/assets/images/icon-account.svg'

useHead({
  link: [{ rel: 'icon', type: 'image/svg+xml', href: faviconUrl }]
})
</script>

<template>
  <DevNoticeBanner />
  <UpdateBanner />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
