<script setup>
// Custom editor for the free-text `attributes.pronouns` prompt field. authentik
// stores pronouns as a single string; we present the three common options as
// checkboxes plus a free-text box for anything else, and (de)serialise to/from a
// comma-separated string so the underlying prompt field is unchanged.
//
//   "he/him, they/them, custom value"  <->  [x] he/him  [ ] she/her  [x] they/them  + "custom value"
const props = defineProps({
  modelValue: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue'])

const OPTIONS = ['he/him', 'she/her', 'they/them']

const checked = reactive({
  'he/him': false,
  'she/her': false,
  'they/them': false
})
const custom = ref('')

// Build the combined comma-separated string from the local state: the checked
// known options (in canonical order) followed by any custom text.
function compose() {
  const parts = OPTIONS.filter((option) => checked[option])
  const extra = custom.value.trim()
  if (extra) {
    parts.push(extra)
  }
  return parts.join(', ')
}

// Parse an incoming value: matched known options drive the checkboxes, everything
// else falls through to the custom text box.
function parse(value) {
  for (const option of OPTIONS) {
    checked[option] = false
  }
  const leftovers = []
  const segments = (value ?? '')
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
  for (const segment of segments) {
    const match = OPTIONS.find((option) => option.toLowerCase() === segment.toLowerCase())
    if (match) {
      checked[match] = true
    } else {
      leftovers.push(segment)
    }
  }
  custom.value = leftovers.join(', ')
}

// Seed from the initial/external value. Re-parse only on a genuine external
// change (one that doesn't already match what our state composes), so the value
// we emit below never clobbers the user's in-progress edits.
watch(
  () => props.modelValue,
  (value) => {
    if (value !== compose()) {
      parse(value)
    }
  },
  { immediate: true }
)

// Push the composed string up whenever a box is toggled or the custom text edited.
watch([checked, custom], () => {
  emit('update:modelValue', compose())
}, { deep: true })
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-col gap-2">
      <label
        v-for="option in OPTIONS"
        :key="option"
        class="flex items-center gap-2 text-sm text-slate-700"
      >
        <input v-model="checked[option]" type="checkbox" class="rounded border-slate-300" />
        <span>{{ option }}</span>
      </label>
    </div>
    <input
      v-model="custom"
      type="text"
      maxlength="30"
      placeholder="Custom (e.g. ze/zir)"
      class="field-input"
    />
  </div>
</template>
