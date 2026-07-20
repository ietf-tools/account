<script setup>
// Edit the signed-in user's details via authentik's user-settings flow. Fields
// are whatever that flow's prompt stage defines (name, email, pronouns, …), so
// the form is rendered generically from useProfile().
definePageMeta({ middleware: 'auth', layout: 'account' })

const { fields, values, nonFieldErrors, loading, saving, error, saved, usingSample, load, save, errorFor } =
  useProfile()

// Map authentik prompt field types onto native input types (mirrors FlowExecutor).
function inputType(field) {
  return (
    { text: 'text', username: 'text', email: 'email', number: 'number', date: 'date', tel: 'tel', url: 'url' }[
      field.type
    ] ?? 'text'
  )
}

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

    <div v-else-if="loading" class="py-10 text-center text-sm text-slate-500">
      Loading your profile…
    </div>

    <form v-else @submit.prevent="save" class="space-y-4">
      <div
        v-for="msg in nonFieldErrors"
        :key="msg.code"
        class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
      >
        {{ msg.string }}
      </div>

      <div v-for="field in fields" :key="field.field_key">
        <template v-if="field.type === 'static'">
          <p class="text-sm text-slate-600" v-html="field.initial_value" />
        </template>
        <template v-else-if="field.type === 'checkbox'">
          <label class="flex items-center gap-2 text-sm text-slate-700">
            <input v-model="values[field.field_key]" type="checkbox" class="rounded border-slate-300" />
            <span v-html="field.label" />
          </label>
        </template>
        <template v-else-if="field.type === 'dropdown'">
          <label class="field-label">{{ field.label }}</label>
          <select v-model="values[field.field_key]" class="field-input">
            <option v-for="choice in field.choices" :key="choice" :value="choice">{{ choice }}</option>
          </select>
        </template>
        <template v-else-if="field.type === 'text_area'">
          <label class="field-label">{{ field.label }}</label>
          <textarea
            v-model="values[field.field_key]"
            class="field-input"
            rows="3"
            :placeholder="field.placeholder"
          />
        </template>
        <template v-else>
          <label class="field-label">{{ field.label }}</label>
          <input
            v-model="values[field.field_key]"
            :type="inputType(field)"
            :placeholder="field.placeholder"
            :required="field.required"
            class="field-input"
          />
        </template>
        <p v-if="errorFor(field.field_key)" class="mt-1 text-sm text-red-600">
          {{ errorFor(field.field_key) }}
        </p>
      </div>

      <div class="flex justify-end">
        <button type="submit" class="btn-primary w-auto px-4" :disabled="saving">
          {{ saving ? 'Saving…' : 'Save changes' }}
        </button>
      </div>
    </form>
  </div>
</template>
