<script setup>
// The signed-in account shell: a wide, centered box with a fixed sidebar of
// account sections on the left and the active section's content on the right.
// Every /account/* page uses this layout (definePageMeta layout: 'account').
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

// Sidebar sections, in display order. Each maps to a page under pages/account/.
// `icon` is the `d` of a single heroicons (v2, outline) path drawn in the nav.
const items = [
  {
    to: '/account/applications',
    label: 'Applications',
    icon: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z'
  },
  {
    to: '/account/profile',
    label: 'Profile',
    icon: 'M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0A9 9 0 1012 21a8.966 8.966 0 005.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z'
  },
  {
    to: '/account/password',
    label: 'Password',
    icon: 'M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H9v1.5H7.5v1.5H6v1.5H3.75a.75.75 0 01-.75-.75v-2.19a.75.75 0 01.22-.53l6.638-6.638c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z'
  },
  {
    to: '/account/mfa',
    label: 'MFA Authenticators',
    icon: 'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.249-8.25-3.286z'
  },
  {
    to: '/account/connected',
    label: 'Connected Services',
    icon: 'M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244'
  },
  {
    to: '/account/sessions',
    label: 'Sessions',
    icon: 'M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25'
  },
  {
    to: '/account/tokens',
    label: 'Tokens',
    icon: 'M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z'
  },
  {
    to: '/account/groups',
    label: 'Groups',
    icon: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z'
  }
]

function isActive(to) {
  return route.path === to
}

const initial = computed(() => {
  const source = auth.user?.name || auth.user?.username || '?'
  return source.charAt(0).toUpperCase()
})

async function onLogout() {
  await auth.logout()
  router.push('/login')
}
</script>

<template>
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
      <div
        class="flex flex-col overflow-hidden rounded-2xl bg-white shadow-xl outline outline-[6px]
          outline-sky-400/40 md:flex-row"
      >
        <!-- Sidebar: identity, section nav, sign-out pinned to the bottom. -->
        <aside class="flex flex-col border-b border-slate-200 bg-slate-50 md:w-64 md:border-b-0 md:border-r">
          <div class="flex items-center gap-3 border-b border-slate-200 p-4">
            <img
              v-if="auth.user?.avatar"
              :src="auth.user.avatar"
              alt=""
              class="h-10 w-10 shrink-0 rounded-full object-cover"
            />
            <span
              v-else
              aria-hidden="true"
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-100
                text-sm font-semibold text-sky-700"
            >
              {{ initial }}
            </span>
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-slate-900">
                {{ auth.user?.name || auth.user?.username }}
              </p>
              <p class="truncate text-xs text-slate-500">{{ auth.user?.email }}</p>
            </div>
          </div>

          <nav class="space-y-1 p-3">
            <NuxtLink
              v-for="item in items"
              :key="item.to"
              :to="item.to"
              class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition"
              :class="
                isActive(item.to)
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              "
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                class="h-5 w-5 shrink-0"
                aria-hidden="true"
              >
                <path stroke-linecap="round" stroke-linejoin="round" :d="item.icon" />
              </svg>
              {{ item.label }}
            </NuxtLink>
          </nav>

          <div class="space-y-2 border-t border-slate-200 p-3">
            <!-- Superusers only. Plain anchor (not NuxtLink) so it leaves the SPA
                 to authentik's admin UI at the domain root rather than resolving
                 under the /app/ base. -->
            <a v-if="auth.user?.isSuperuser" href="/if/admin/" class="btn-social w-full">
              Administration Area
            </a>
            <button class="btn-social w-full text-red-600" @click="onLogout">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="h-5 w-5 shrink-0" aria-hidden="true">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"
                />
              </svg>
              Sign out
            </button>
          </div>
        </aside>

        <main class="min-w-0 flex-1 p-6 sm:p-8">
          <slot />
        </main>
      </div>
    </div>
  </div>
</template>
