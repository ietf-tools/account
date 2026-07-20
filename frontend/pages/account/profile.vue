<script setup>
// Edit the signed-in user's details via authentik's user-settings flow. Fields
// are whatever that flow's prompt stage defines (name, email, pronouns, …), so
// the form is rendered generically from useProfile().
definePageMeta({ middleware: 'auth', layout: 'account' })

const { fields, values, nonFieldErrors, loading, saving, error, saved, usingSample, load, save, errorFor } =
  useProfile()

onMounted(load)
</script>

<template>
  <div>
    <TabHeader title="Profile" subtitle="Your name, email and other account details." />

    <div v-if="usingSample" class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
      Showing a sample form (dev) — no live authentik session.
    </div>

    <div v-if="saved" class="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
      Your profile has been updated.
    </div>

    <div v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</div>

    <LoadingState v-else-if="loading" text="Loading your profile…" />

    <form v-else @submit.prevent="save" class="space-y-4">
      <div
        v-for="msg in nonFieldErrors"
        :key="msg.code"
        class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
      >
        {{ msg.string }}
      </div>

      <PromptFields :fields="fields" :values="values" :error-for="errorFor" />

      <div class="flex justify-end">
        <button type="submit" class="btn-primary w-auto px-4" :disabled="saving">
          {{ saving ? 'Saving…' : 'Save changes' }}
        </button>
      </div>
    </form>
  </div>
</template>
