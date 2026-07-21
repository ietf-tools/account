<script setup>
// A non-blocking bar offering a reload when a newer build has been deployed while
// this tab stayed open. State comes from useAppUpdate(); the polling that flips it
// lives in plugins/version-check.client.js.
const { updateAvailable, reload } = useAppUpdate()
</script>

<template>
  <Transition
    enter-active-class="transition duration-300 ease-out"
    enter-from-class="-translate-y-full opacity-0"
    enter-to-class="translate-y-0 opacity-100"
  >
    <div
      v-if="updateAvailable"
      role="status"
      class="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 border-b
        border-sky-400/40 bg-sky-600 px-4 py-2.5 text-sm text-white shadow-lg"
    >
      <span class="font-medium">A new version of IETF Account is available.</span>
      <button
        type="button"
        class="rounded-md bg-white/15 px-3 py-1 text-sm font-semibold transition hover:bg-white/25"
        @click="reload"
      >
        Reload
      </button>
    </div>
  </Transition>
</template>
