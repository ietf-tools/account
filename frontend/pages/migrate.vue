<script setup>
// Custom, backend-driven flow (not an authentik flow): verify the user against
// the legacy Django system, then recreate their account in authentik.
//
// Two steps:
//   1. Validate the legacy credentials — the backend returns the emails
//      associated with the account.
//   2. Pick which email to use for the new account, optionally set a new
//      password, and complete the migration.
const api = useApi()

const step = ref(1)
const form = reactive({ identifier: '', password: '', selectedEmail: '', newPassword: '' })
const emails = ref([])
const loading = ref(false)
const error = ref(null)
const done = ref(false)

// Inline, per-field warnings for step 1, cleared as the user types (see below).
const identifierError = ref('')
const passwordError = ref('')

// Validate the credentials client-side before hitting the backend, so a missing
// or malformed email / password gives a specific inline message rather than a
// generic "Bad Request" from the server.
function validateCredentials() {
  identifierError.value = ''
  passwordError.value = ''
  const identifier = form.identifier.trim()
  if (!identifier) {
    identifierError.value = 'Please enter your email address.'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
    identifierError.value = 'Please enter a valid email address.'
  }
  if (!form.password) {
    passwordError.value = 'Please enter your current password.'
  }
  return !identifierError.value && !passwordError.value
}

watch(() => form.identifier, () => (identifierError.value = ''))
watch(() => form.password, () => (passwordError.value = ''))

// `autofocus` doesn't fire on client-side navigation or when the step swaps, so
// focus the relevant field programmatically.
const identifierInput = ref(null)
const step2Input = ref(null)
onMounted(() => {
  nextTick(() => identifierInput.value?.focus())
})

async function onValidate() {
  if (!validateCredentials()) {
    return
  }
  loading.value = true
  error.value = null
  try {
    const res = await api('/migration/validate', {
      method: 'POST',
      body: { identifier: form.identifier, password: form.password }
    })
    emails.value = res.emails
    form.selectedEmail = res.emails[0] ?? ''
    step.value = 2
    nextTick(() => step2Input.value?.focus())
  } catch (e) {
    error.value = e?.data?.error || 'We could not validate those credentials. Please try again.'
  } finally {
    loading.value = false
  }
}

async function onMigrate() {
  loading.value = true
  error.value = null
  try {
    await api('/migration/migrate', {
      method: 'POST',
      body: { email: form.selectedEmail, newPassword: form.newPassword }
    })
    done.value = true
  } catch (e) {
    error.value = e?.data?.error || 'Migration failed. Please try again.'
  } finally {
    loading.value = false
  }
}

function backToCredentials() {
  step.value = 1
  error.value = null
  nextTick(() => identifierInput.value?.focus())
}
</script>

<template>
  <div class="card">
    <h1 class="mb-1 text-xl font-semibold text-slate-900">Migrate your Datatracker account</h1>
    <p class="mb-6 text-sm text-slate-500">
      Enter the credentials you used to login on Datatracker. We'll migrate your account
      over and link it.
    </p>

    <div v-if="error" class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</div>

    <div v-if="done" class="space-y-4">
      <div class="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
        Your account has been migrated. You can now sign in with your credentials.
      </div>
      <NuxtLink to="/login" class="btn-primary">Go to sign in</NuxtLink>
    </div>

    <!-- Step 1: validate legacy credentials -->
    <form v-else-if="step === 1" @submit.prevent="onValidate" class="space-y-4">
      <div>
        <label class="field-label">Email</label>
        <input ref="identifierInput" v-model="form.identifier" class="field-input" autocomplete="username" />
        <p v-if="identifierError" class="mt-1 text-sm text-red-600">{{ identifierError }}</p>
      </div>
      <div>
        <label class="field-label">Current Password</label>
        <input v-model="form.password" type="password" class="field-input" autocomplete="current-password" />
        <p v-if="passwordError" class="mt-1 text-sm text-red-600">{{ passwordError }}</p>
      </div>
      <button type="submit" class="btn-primary" :disabled="loading">
        {{ loading ? 'Validating…' : 'Validate and continue' }}
      </button>
    </form>

    <!-- Step 2: choose the account email and complete the migration -->
    <form v-else @submit.prevent="onMigrate" class="space-y-4">
      <div>
        <label class="field-label">Account email</label>
        <select
          v-if="emails.length > 1"
          ref="step2Input"
          v-model="form.selectedEmail"
          class="field-input"
        >
          <option v-for="email in emails" :key="email" :value="email">{{ email }}</option>
        </select>
        <p v-else class="text-sm text-slate-900">{{ form.selectedEmail }}</p>
        <p class="mt-1 text-xs text-slate-400">This email will be used for your new account.</p>
      </div>
      <div>
        <label class="field-label">New Password <span class="text-slate-400">(optional)</span></label>
        <input
          :ref="emails.length > 1 ? undefined : 'step2Input'"
          v-model="form.newPassword"
          type="password"
          class="field-input"
          autocomplete="new-password"
        />
        <p class="mt-1 text-xs text-slate-400">Leave blank to keep your existing password.</p>
      </div>
      <button type="submit" class="btn-primary" :disabled="loading">
        {{ loading ? 'Migrating…' : 'Migrate account' }}
      </button>
      <button type="button" class="link block w-full text-center text-sm" @click="backToCredentials">
        Back
      </button>
    </form>

    <div class="mt-6 text-center text-sm text-slate-500">
      <NuxtLink to="/login" class="link">Back to sign in</NuxtLink>
    </div>
  </div>
</template>
