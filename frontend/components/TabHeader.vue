<script setup>
// Consistent heading for each account section (right-hand content panel).
defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' }
})
</script>

<template>
  <div class="mb-6">
    <h1 class="text-xl font-semibold text-slate-900">{{ title }}</h1>
    <p v-if="subtitle" class="mt-1 text-sm text-slate-500">{{ subtitle }}</p>
  </div>
</template>
