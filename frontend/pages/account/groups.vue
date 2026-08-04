<script setup>
// Groups the signed-in user belongs to. Already resolved into the auth store from
// authentik's /core/users/me/ (groups_obj -> names), so no extra fetch needed.
definePageMeta({ middleware: 'auth', layout: 'account' })

const auth = useAuthStore()
const groups = computed(() => auth.user?.groups ?? [])
</script>

<template>
  <div>
    <TabHeader title="Groups" subtitle="Permission groups your account belongs to." />

    <ul v-if="groups.length" class="space-y-2">
      <li
        v-for="group in groups"
        :key="group"
        class="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3
          text-sm font-medium text-slate-800"
      >
        <span
          aria-hidden="true"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sky-100 text-sky-700"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="h-4 w-4"
          >
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </span>
        {{ group }}
      </li>
    </ul>

    <div
      v-else
      class="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center
        text-sm text-slate-500"
    >
      You're not a member of any groups.
    </div>
  </div>
</template>
