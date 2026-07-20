<template>
  <!-- Like the default layout, but the content column is wide enough for a grid
       (the applications view) rather than the narrow auth card. Keeps the shared
       network background, logo and title; drops the card-hugging side glows,
       which are positioned for the max-w-md card. -->
  <div class="flex min-h-screen flex-col items-center justify-center px-4 py-10">
    <NetworkBackground />

    <div class="relative isolate mb-8 flex flex-col items-center">
      <div
        aria-hidden="true"
        class="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-52 w-[34rem] max-w-[92vw]
          -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-slate-950 blur-2xl"
      />
      <img src="https://static.ietf.org/logos/ietf-inverted.svg" alt="IETF" class="h-16 w-auto" />
      <h1 class="mt-4 text-2xl font-semibold text-slate-100">IETF Account</h1>
    </div>

    <div class="relative w-full max-w-4xl">
      <slot />
    </div>
  </div>
</template>
