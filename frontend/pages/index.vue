<script setup>
definePageMeta({ middleware: 'auth' })

const auth = useAuthStore()
const router = useRouter()

async function onLogout() {
  await auth.logout()
  router.push('/login')
}
</script>

<template>
  <div class="card">
    <h1 class="mb-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
      Welcome, {{ auth.user?.name || auth.user?.username }}
    </h1>
    <p class="mb-6 text-sm text-slate-500 dark:text-slate-400">You're signed in through authentik.</p>

    <dl class="space-y-2 text-sm">
      <div class="flex justify-between border-b border-slate-100 py-1 dark:border-slate-800">
        <dt class="text-slate-500 dark:text-slate-400">Username</dt>
        <dd class="font-medium">{{ auth.user?.username }}</dd>
      </div>
      <div class="flex justify-between border-b border-slate-100 py-1 dark:border-slate-800">
        <dt class="text-slate-500 dark:text-slate-400">Email</dt>
        <dd class="font-medium">{{ auth.user?.email }}</dd>
      </div>
      <div v-if="auth.user?.groups?.length" class="flex justify-between border-b border-slate-100 py-1 dark:border-slate-800">
        <dt class="text-slate-500 dark:text-slate-400">Groups</dt>
        <dd class="font-medium">{{ auth.user.groups.join(', ') }}</dd>
      </div>
    </dl>

    <button class="btn-social mt-6 w-full" @click="onLogout">Sign out</button>
  </div>
</template>
