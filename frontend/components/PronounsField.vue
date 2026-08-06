<script setup>
// Custom editor for the free-text `attributes.pronouns` prompt field. authentik
// stores pronouns as a single string; we present the three common options as
// radio buttons plus a "Custom" option with a free-text box, so exactly one
// choice is possible. The underlying prompt field is unchanged — it just receives
// the selected option, the custom text, or an empty string.
//
//   "they/them"    <->  ( ) he/him  ( ) she/her  (•) they/them
//   "ze/zir"       <->  (•) Custom  + "ze/zir"
const props = defineProps({
  modelValue: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue'])

const OPTIONS = ['he/him', 'she/her', 'they/them']
// Sentinels for the two choices that aren't one of the known options.
const NONE = ''
const CUSTOM = 'custom'

// Radios need a shared `name` for native grouping/keyboard behaviour, and it must
// be unique per instance.
const groupName = `pronouns-${useId()}`

const selected = ref(NONE)
const custom = ref('')
const customInput = ref(null)

// The single value to store: the picked option, the custom text, or nothing.
function compose() {
  if (selected.value === CUSTOM) {
    return custom.value.trim()
  }
  if (OPTIONS.includes(selected.value)) {
    return selected.value
  }
  return ''
}

// Parse an incoming value: a known option selects its radio, anything else lands
// in Custom (which is also where a legacy multi-value string like
// "he/him, they/them" ends up — kept verbatim rather than silently dropped).
function parse(value) {
  const text = (value ?? '').trim()
  if (!text) {
    selected.value = NONE
    custom.value = ''
    return
  }
  const match = OPTIONS.find((option) => option.toLowerCase() === text.toLowerCase())
  if (match) {
    selected.value = match
    custom.value = ''
    return
  }
  selected.value = CUSTOM
  custom.value = text
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

// Push the composed string up whenever the choice or the custom text changes.
watch([selected, custom], () => {
  emit('update:modelValue', compose())
})

// Picking Custom is only half the action — put the cursor where the rest of it
// goes.
async function onSelectCustom() {
  await nextTick()
  customInput.value?.focus()
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <label
      v-for="option in OPTIONS"
      :key="option"
      class="flex items-center gap-2 text-sm text-slate-700"
    >
      <input
        v-model="selected"
        type="radio"
        :name="groupName"
        :value="option"
        class="border-slate-300"
      />
      <span>{{ option }}</span>
    </label>

    <!-- The custom option and the value it takes share one row. The text input is
         deliberately NOT inside the label: a label isn't activated by clicks on an
         interactive descendant, so it would look clickable and do nothing. -->
    <div class="flex items-center gap-2 text-sm text-slate-700">
      <label class="flex items-center">
        <input
          v-model="selected"
          type="radio"
          :name="groupName"
          :value="CUSTOM"
          class="border-slate-300"
          @change="onSelectCustom"
        />
        <span class="sr-only">Use custom pronouns</span>
      </label>
      <input
        ref="customInput"
        v-model="custom"
        type="text"
        maxlength="30"
        placeholder="Custom (e.g. ze/zir)"
        aria-label="Custom pronouns"
        class="field-input flex-1 disabled:cursor-not-allowed disabled:bg-slate-50
          disabled:text-slate-400"
        :disabled="selected !== CUSTOM"
      />
    </div>

    <!-- Radios can't be un-picked, so there has to be a way back to "no pronouns
         on file". -->
    <label class="flex items-center gap-2 text-sm text-slate-700">
      <input
        v-model="selected"
        type="radio"
        :name="groupName"
        :value="NONE"
        class="border-slate-300"
      />
      <span>Unspecified / Prefer not to say</span>
    </label>
  </div>
</template>
