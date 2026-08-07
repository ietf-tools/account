<script setup>
// Page chrome shown under the box in both layouts — deliberately outside the card,
// since it belongs to the site rather than to whatever flow or account section is
// on screen. See the layouts for the placement rule: it sits at the bottom of the
// viewport when the content is short, and is pushed below the fold when it isn't.
//
// Three columns: our support links, the running version, then the wider IETF sites.
// Wider than either box (the auth card and the account shell) by design.

// App version, injected at build time from package.json (see nuxt.config.ts).
const appVersion = useRuntimeConfig().public.appVersion

const supportLinks = [
  { label: 'Support', href: 'mailto:support@ietf.org' },
  { label: 'System Status', href: 'https://status.ietf.org/' },
  { label: 'Report a bug', href: 'https://github.com/ietf-tools/account/issues' }
]

const ietfLinks = [
  { label: 'IETF', href: 'https://www.ietf.org/' },
  { label: 'Datatracker', href: 'https://datatracker.ietf.org/' },
  { label: 'RFC Editor', href: 'https://www.rfc-editor.org/' }
]
</script>

<template>
  <footer
    class="mx-auto mt-10 flex w-full max-w-[1100px] flex-col items-center gap-y-3 text-xs
      sm:grid sm:grid-cols-3 sm:items-center"
  >
    <FooterLinks :links="supportLinks" class="sm:justify-start" />
    <!-- Hidden on mobile, where the three columns stack and it's just noise. -->
    <p class="hidden text-center text-sky-200/35 sm:block">Version {{ appVersion }}</p>
    <FooterLinks :links="ietfLinks" class="sm:justify-end" />
  </footer>
</template>
