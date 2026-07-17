<template>
  <div class="flex min-h-screen flex-col items-center justify-center px-4 py-10">
    <NetworkBackground />

    <!-- `isolate` keeps the glow's negative z-index local: it sits above the
         network canvas (-z-20) but behind the logo/title, so the animation
         fades into the page background as it passes behind them. -->
    <div class="relative isolate mb-8 flex flex-col items-center">
      <div
        aria-hidden="true"
        class="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-52 w-[34rem] max-w-[92vw]
          -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-slate-950 blur-2xl"
      />
      <img src="https://static.ietf.org/logos/ietf-inverted.svg" alt="IETF" class="h-16 w-auto" />
      <h1 class="mt-4 text-2xl font-semibold text-slate-100">IETF Account</h1>
    </div>

    <div class="relative w-full max-w-md">
      <!-- Subtle glows rising from under the box: sky blue (left), yellow (right) -->
      <div
        aria-hidden="true"
        class="pointer-events-none absolute top-1/2 -left-20 -z-10 h-56 w-56 -translate-y-1/2 rounded-full bg-[#0796ce]/30 blur-[96px]"
      />
      <div
        aria-hidden="true"
        class="pointer-events-none absolute top-1/2 -right-20 -z-10 h-56 w-56 -translate-y-1/2 rounded-full bg-[#0796ce]/30 blur-[96px]"
      />
      <slot />
    </div>
  </div>
</template>
