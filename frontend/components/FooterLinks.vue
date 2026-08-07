<script setup>
// One group of footer links, separated by thin vertical rules. Used for both
// groups in SiteFooter; the caller positions it (e.g. `sm:justify-end`).
defineProps({
  links: { type: Array, required: true }
})

// Leave the tab on the current page for anything that isn't ours: a flow can be
// mid-way through, and losing it to an external site would be worse than a new tab.
function isExternal(href) {
  return /^https?:/i.test(href)
}
</script>

<template>
  <div class="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
    <template v-for="(link, index) in links" :key="link.href">
      <span v-if="index > 0" aria-hidden="true" class="h-3 w-px bg-sky-400/25" />
      <a
        :href="link.href"
        :target="isExternal(link.href) ? '_blank' : undefined"
        :rel="isExternal(link.href) ? 'noopener' : undefined"
        class="rounded text-sky-200/50 transition hover:text-sky-300 focus:outline-none
          focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2
          focus-visible:ring-offset-slate-950"
      >
        {{ link.label }}
      </a>
    </template>
  </div>
</template>
