<script setup>
// Stand-in for account sections whose authentik integration isn't wired up yet.
// Keeps navigation working end-to-end; each gets fleshed out individually.
defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' }
})
</script>

<template>
  <div>
    <TabHeader :title="title" :subtitle="subtitle" />
    <div
      class="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center
        text-sm text-slate-500"
    >
      This section is coming soon.
    </div>
  </div>
</template>
