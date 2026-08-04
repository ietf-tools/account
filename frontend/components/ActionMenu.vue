<script setup>
// A "…" button that reveals a right-aligned dropdown of actions, for rows with
// more actions than fit as buttons (the Connected Services GitHub row). The
// default slot is the menu body — it receives `close`, so an action can dismiss
// the menu as it fires; use the `.menu-item` class for each entry.
//
// Closes on Escape and on any pointer-down outside the menu. Deliberately not a
// <dialog>/popover: this sits inside a list row and only ever holds a few
// buttons, so plain absolute positioning is enough.
defineProps({
  // Accessible name for the trigger (there's no visible label, just the dots).
  label: { type: String, default: 'More actions' },
  disabled: { type: Boolean, default: false }
})

const open = ref(false)
const root = ref(null)

function close() {
  open.value = false
}

function onPointerDown(event) {
  if (root.value && !root.value.contains(event.target)) {
    close()
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown)
})
</script>

<template>
  <div ref="root" class="relative shrink-0" @keydown.esc="close">
    <button
      type="button"
      class="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-300
        bg-white p-2.5 text-slate-500 shadow-sm transition hover:border-sky-300 hover:bg-sky-50
        hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
      :class="open ? 'border-sky-300 bg-sky-50 text-sky-700' : ''"
      :disabled="disabled"
      :title="label"
      :aria-label="label"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="open = !open"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" class="h-4 w-4" aria-hidden="true">
        <circle cx="5" cy="12" r="1.75" />
        <circle cx="12" cy="12" r="1.75" />
        <circle cx="19" cy="12" r="1.75" />
      </svg>
    </button>

    <div
      v-if="open"
      role="menu"
      class="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200
        bg-white py-1 shadow-lg"
    >
      <slot :close="close" />
    </div>
  </div>
</template>
