<script setup>
// Strength meter for a new-password field: a thin bar under the input that grows
// and shifts red → amber → lime → green as the password gets stronger. Scoring is
// advisory (see utils/passwordStrength.js) — authentik's own password policies are
// what actually accept or reject the value, and they report through field errors.
const props = defineProps({
  password: { type: String, default: '' }
})

const strength = computed(() => passwordStrength(props.password))

const BAR = ['bg-red-500', 'bg-amber-500', 'bg-lime-500', 'bg-green-500']
const TEXT = ['text-red-600', 'text-amber-600', 'text-lime-600', 'text-green-600']
</script>

<template>
  <!-- The label keeps its line whether or not there's a password, so typing the
       first character doesn't shove the rest of the form down. -->
  <div class="mt-1.5">
    <div
      class="h-1 w-full overflow-hidden rounded-full bg-slate-200"
      role="progressbar"
      aria-label="Password strength"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="strength.percent"
      :aria-valuetext="strength.label || 'Empty'"
    >
      <div
        class="h-full rounded-full transition-all duration-300"
        :class="BAR[strength.level]"
        :style="{ width: `${strength.percent}%` }"
      />
    </div>
    <p class="mt-1 h-4 text-xs" :class="TEXT[strength.level]">{{ strength.label }}</p>
  </div>
</template>
