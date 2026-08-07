<template>
  <!-- Two rows: the card group grows to fill the viewport and centres itself
       inside that space, then the footer. So the footer lands at the bottom of
       the screen when the card is short, and is pushed past the fold (scroll to
       reach it) when the card is taller than the viewport. -->
  <div class="flex min-h-screen flex-col px-4 pt-10 pb-6">
    <NetworkBackground />

    <div class="flex flex-1 flex-col items-center justify-center">
      <!-- `isolate` keeps the glow's negative z-index local: it sits above the
           network canvas (-z-20) but behind the logo/title, so the animation
           fades into the page background as it passes behind them. -->
      <div class="relative isolate mb-8 flex flex-col items-center">
        <div
          aria-hidden="true"
          class="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-52 w-[34rem] max-w-[92vw]
            -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-slate-950 blur-2xl"
        />
        <!-- Home is the app root (/app/ — NuxtLink applies app.baseURL), which routes
             on to the account shell, or to sign-in when there's no session. -->
        <NuxtLink
          to="/"
          class="rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400
            focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
        >
          <img src="https://static.ietf.org/logos/ietf-inverted.svg" alt="IETF" class="h-16 w-auto" />
        </NuxtLink>
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

    <SiteFooter />
  </div>
</template>
