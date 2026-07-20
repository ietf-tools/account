<script setup>
// Groups the signed-in user belongs to. Already resolved into the auth store from
// authentik's /core/users/me/ (groups_obj -> names), so no extra fetch needed.
definePageMeta({ middleware: 'auth', layout: 'account' })

const auth = useAuthStore()
const groups = computed(() => auth.user?.groups ?? [])
</script>

<template>
  <div>
    <TabHeader title="Groups" subtitle="Groups your account belongs to." />

    <ul v-if="groups.length" class="space-y-2">
      <li
        v-for="group in groups"
        :key="group"
        class="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3
          text-sm font-medium text-slate-800"
      >
        <span
          aria-hidden="true"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sky-100 text-xs
            font-semibold text-sky-700"
        >
          {{ group.charAt(0).toUpperCase() }}
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
