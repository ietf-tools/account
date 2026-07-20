<script setup>
// Centered spinner + label for a tab's loading state — the same spinner used by
// the login flow (FlowExecutor).
defineProps({
  text: { type: String, default: 'Loading…' }
})
</script>

<template>
  <div class="flex flex-col items-center gap-3 py-10 text-sm text-slate-400">
    <span
      class="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500"
      role="status"
      aria-label="Loading"
    />
    <span>{{ text }}</span>
  </div>
</template>
