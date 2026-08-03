<script setup>
// Renders an authentik prompt stage's fields (used by the Profile and Password
// tabs). `values` is a reactive object the inputs write straight into via
// v-model; `errorFor` maps a field_key to its server-side error string.
defineProps({
  fields: { type: Array, required: true },
  values: { type: Object, required: true },
  errorFor: { type: Function, default: () => '' }
})

// Map authentik prompt field types onto native input types (mirrors FlowExecutor).
function inputType(field) {
  return (
    {
      text: 'text',
      username: 'text',
      email: 'email',
      password: 'password',
      number: 'number',
      date: 'date',
      tel: 'tel',
      url: 'url'
    }[field.type] ?? 'text'
  )
}
</script>

<template>
  <div class="space-y-4">
    <div v-for="field in fields" :key="field.field_key">
      <template v-if="field.field_key === 'attributes.pronouns'">
        <label class="field-label">
          {{ field.label }}<span v-if="field.required" class="text-red-500"> *</span>
        </label>
        <PronounsField v-model="values[field.field_key]" />
      </template>
      <template v-else-if="field.type === 'static'">
        <p class="text-sm text-slate-600" v-html="field.initial_value" />
      </template>
      <template v-else-if="field.type === 'checkbox'">
        <label class="flex items-center gap-2 text-sm text-slate-700">
          <input v-model="values[field.field_key]" type="checkbox" class="rounded border-slate-300" />
          <span><span v-html="field.label" /><span v-if="field.required" class="text-red-500"> *</span></span>
        </label>
      </template>
      <template v-else-if="field.type === 'dropdown'">
        <label class="field-label">
          {{ field.label }}<span v-if="field.required" class="text-red-500"> *</span>
        </label>
        <select v-model="values[field.field_key]" class="field-input">
          <option v-for="choice in field.choices" :key="choice" :value="choice">{{ choice }}</option>
        </select>
      </template>
      <template v-else-if="field.type === 'text_area'">
        <label class="field-label">
          {{ field.label }}<span v-if="field.required" class="text-red-500"> *</span>
        </label>
        <textarea
          v-model="values[field.field_key]"
          class="field-input"
          rows="3"
          :placeholder="field.placeholder"
        />
      </template>
      <template v-else>
        <label class="field-label">
          {{ field.label }}<span v-if="field.required" class="text-red-500"> *</span>
        </label>
        <input
          v-model="values[field.field_key]"
          :type="inputType(field)"
          :placeholder="field.placeholder"
          :required="field.required"
          :autocomplete="field.type === 'password' ? 'new-password' : undefined"
          class="field-input"
        />
      </template>

      <!-- authentik field help text (sub_text); may contain HTML, as its own UI renders it. -->
      <p
        v-if="field.sub_text && field.type !== 'static'"
        class="mt-1 text-xs text-slate-400"
        v-html="field.sub_text"
      />
      <p v-if="errorFor(field.field_key)" class="mt-1 text-sm text-red-600">
        {{ errorFor(field.field_key) }}
      </p>
    </div>
  </div>
</template>
