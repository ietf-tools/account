<template>
  <!-- Standing notice that this deployment isn't the real thing, shown on every
       page (rendered from app.vue). Unconditional on purpose: the point is to warn
       people on the *deployed* test environment, so it must survive the production
       build — drop the tag from app.vue when the site goes live. Sits below
       UpdateBanner's z-[100] so that one stays on top if both ever show at once. -->
  <div
    class="fixed inset-x-0 top-0 z-[90] flex items-center justify-center gap-2 border-b
      border-red-400/40 bg-red-600 px-4 py-2.5 text-center text-sm text-white shadow-lg"
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
    <p>
      <span class="font-semibold">For development / testing only.</span>
      This site is not for public use.
    </p>
  </div>
</template>
