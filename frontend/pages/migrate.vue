<script setup>
// Custom, backend-driven flow (not an authentik flow): verify the user against
// the legacy Django system, then recreate their account in authentik.
const api = useApi()

const form = reactive({ identifier: '', password: '', newPassword: '' })
const loading = ref(false)
const error = ref(null)
const done = ref(false)

// Focus the email field on mount (the HTML `autofocus` attribute doesn't fire on
// client-side route navigation into this page).
const identifierInput = ref(null)
onMounted(() => {
  nextTick(() => identifierInput.value?.focus())
})

async function onSubmit() {
  loading.value = true
  error.value = null
  try {
    await api('/migration/migrate', { method: 'POST', body: { ...form } })
    done.value = true
  } catch (e) {
    error.value = e?.data?.error || 'Migration failed. Please check your details.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="card">
    <h1 class="mb-1 text-xl font-semibold text-slate-900 dark:text-slate-100">Migrate your Datatracker account</h1>
    <p class="mb-6 text-sm text-slate-500 dark:text-slate-400">
      Enter the credentials you used to login on Datatracker. We'll migrate your account
      over so you can sign in here.
    </p>

    <div v-if="error" class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{{ error }}</div>

    <div v-if="done" class="space-y-4">
      <div class="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/50 dark:text-green-300">
        Your account has been migrated. You can now sign in with your credentials.
      </div>
      <NuxtLink to="/login" class="btn-primary">Go to sign in</NuxtLink>
    </div>

    <form v-else @submit.prevent="onSubmit" class="space-y-4">
      <div>
        <label class="field-label">Email</label>
        <input ref="identifierInput" v-model="form.identifier" class="field-input" autocomplete="username" />
      </div>
      <div>
        <label class="field-label">Current Password</label>
        <input v-model="form.password" type="password" class="field-input" autocomplete="current-password" />
      </div>
      <div>
        <label class="field-label">New Password <span class="text-slate-400 dark:text-slate-500">(optional)</span></label>
        <input v-model="form.newPassword" type="password" class="field-input" autocomplete="new-password" />
        <p class="mt-1 text-xs text-slate-400 dark:text-slate-500">Leave blank to keep your existing password.</p>
      </div>
      <button type="submit" class="btn-primary" :disabled="loading">
        {{ loading ? 'Migrating…' : 'Migrate account' }}
      </button>
    </form>

    <div class="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
      <NuxtLink to="/login" class="link">Back to sign in</NuxtLink>
    </div>
  </div>
</template>
