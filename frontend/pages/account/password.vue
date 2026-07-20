<script setup>
// Change the signed-in user's password via authentik's password-change flow.
// Fields (and password policies) come from that flow's prompt stage, rendered by
// the shared PromptFields component; driving lives in usePassword().
definePageMeta({ middleware: 'auth', layout: 'account' })

const { fields, values, nonFieldErrors, loading, saving, error, saved, usingSample, load, save, errorFor } =
  usePassword()

onMounted(load)
</script>

<template>
  <div>
    <TabHeader title="Password" subtitle="Set a new password for your account." />

    <div v-if="usingSample" class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
      Showing a sample form (dev) — no live authentik session.
    </div>

    <div v-if="saved" class="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
      Your password has been changed.
    </div>

    <div v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</div>

    <LoadingState v-else-if="loading" text="Loading…" />

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
          {{ saving ? 'Changing…' : 'Change password' }}
        </button>
      </div>
    </form>
  </div>
</template>
