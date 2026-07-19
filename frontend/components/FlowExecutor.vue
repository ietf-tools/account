<script setup>
// Renders an authentik flow as a sequence of challenges and submits each stage
// straight to authentik's Flow Executor (see useFlow). This is where you fully
// own the login UI: every stage below is just markup you control, driven by the
// challenge JSON authentik hands back. Add branches here as you enable more stages.
const props = defineProps({
  kind: { type: String, required: true }, // authentication | enrollment | recovery
  title: { type: String, default: '' }
})
const emit = defineEmits(['complete'])

const { challenge, complete, user, loading, error, begin, submit } = useFlow(props.kind)

// Local form model, reset whenever the stage changes.
const model = reactive({})
const component = computed(() => challenge.value?.component)

// The active stage's <form>, used to focus its first field on every stage change
// (the HTML `autofocus` attribute only fires on initial parse, not on Vue stage
// swaps — e.g. moving to the password step, or "Not you?" returning to email).
const formEl = ref(null)

function focusFirstField() {
  nextTick(() => {
    formEl.value?.querySelector('input:not([type="hidden"]), select, textarea')?.focus()
  })
}

watch(challenge, (c) => {
  for (const key of Object.keys(model)) {
    delete model[key]
  }
  uidError.value = ''
  if (!c) {
    return
  }
  // Seed prompt fields with their initial values.
  if (c.component === 'ak-stage-prompt') {
    for (const field of c.fields ?? []) {
      model[field.field_key] = field.initial_value ?? (field.type === 'checkbox' ? false : '')
    }
  }
  focusFirstField()
})

watch(complete, (done) => {
  if (done) {
    emit('complete', user.value)
  }
})

onMounted(begin)

// Per-field server-side validation errors, keyed by field name.
const fieldErrors = computed(() => challenge.value?.response_errors ?? {})
function errorFor(key) {
  return fieldErrors.value?.[key]?.map((e) => e.string).join(' ')
}

// Client-side warning for the identification field, cleared as the user types
// and whenever the stage changes (see the challenge watcher above).
const uidError = ref('')

function validateIdentification() {
  const value = (model.uid_field ?? '').trim()
  const isEmail = challenge.value?.user_fields?.includes('email')
  if (!value) {
    uidError.value = `Please enter your ${isEmail ? 'email address' : 'username'}.`
    return false
  }
  if (isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    uidError.value = 'Please enter a valid email address.'
    return false
  }
  uidError.value = ''
  return true
}

async function onSubmit() {
  if (component.value === 'ak-stage-identification' && !validateIdentification()) {
    return
  }

  const payload = {}
  switch (component.value) {
    case 'ak-stage-identification':
      payload.uid_field = model.uid_field
      if (challenge.value.password_fields) {
        payload.password = model.password
      }
      break
    case 'ak-stage-password':
      payload.password = model.password
      break
    case 'ak-stage-authenticator-validate':
      payload.code = model.code
      break
    case 'ak-stage-prompt':
      Object.assign(payload, model)
      break
    default:
      Object.assign(payload, model)
  }
  await submit(payload).catch(() => {})
}

// Map authentik prompt field types onto native input types.
function inputType(field) {
  return { text: 'text', username: 'text', email: 'email', password: 'password', number: 'number', date: 'date', tel: 'tel', url: 'url' }[field.type] ?? 'text'
}

// Social / source logins can't be driven headlessly like password stages: the
// browser has to leave to authentik (and on to Google/GitHub/Apple) and come
// back. We send it to the source's login URL with a `next` that returns to this
// same page carrying `?social=return`, which login.vue picks up to finalize the
// session. `source.url` is the absolute endpoint withSources() resolved for us.
function continueWithSource(source) {
  if (!source.url) {
    return
  }
  const back = new URL(window.location.href)
  back.hash = ''
  back.search = ''
  back.searchParams.set('social', 'return')
  const url = new URL(source.url)
  url.searchParams.set('next', back.toString())
  window.location.href = url.toString()
}
</script>

<template>
  <div class="card">
    <h1 class="mb-1 text-xl font-semibold text-slate-900">
      {{ title || challenge?.flow_info?.title || 'Authentik' }}
    </h1>
    <p v-if="challenge?.pending_user" class="mb-6 text-sm text-slate-500">
      Continue as {{ challenge.pending_user }}
      <button type="button" class="link" :disabled="loading" @click="begin">(Not you?)</button>
    </p>
    <div v-else class="mb-6" />

    <!-- Global (non-field) errors -->
    <div v-if="error" class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ error }}
    </div>
    <div
      v-for="msg in challenge?.response_errors?.non_field_errors"
      :key="msg.code"
      class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
    >
      {{ msg.string }}
    </div>

    <!-- Flow complete -->
    <div v-if="complete" class="text-sm text-slate-600">
      <slot name="complete">You're all set.</slot>
    </div>

    <!-- Initial load -->
    <div v-else-if="!challenge" class="flex flex-col items-center gap-3 py-6 text-sm text-slate-400">
      <span
        class="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500"
        role="status"
        aria-label="Loading"
      />
      <span>Loading…</span>
    </div>

    <!-- Active stage -->
    <form v-else ref="formEl" @submit.prevent="onSubmit" class="space-y-4">
      <!-- Identification: username/email (+ optional inline password) -->
      <template v-if="component === 'ak-stage-identification'">
        <div>
          <label class="field-label">{{ challenge.user_fields?.includes('email') ? 'Email' : 'Username' }}</label>
          <input
            v-model="model.uid_field"
            class="field-input"
            autocomplete="username"
            autofocus
            @input="uidError = ''"
          />
          <p v-if="uidError || errorFor('uid_field')" class="mt-1 text-sm text-red-600">
            {{ uidError || errorFor('uid_field') }}
          </p>
        </div>
        <div v-if="challenge.password_fields">
          <label class="field-label">Password</label>
          <input v-model="model.password" type="password" class="field-input" autocomplete="current-password" />
          <p v-if="errorFor('password')" class="mt-1 text-sm text-red-600">{{ errorFor('password') }}</p>
        </div>
      </template>

      <!-- Dedicated password stage -->
      <template v-else-if="component === 'ak-stage-password'">
        <div>
          <label class="field-label">Password</label>
          <input v-model="model.password" type="password" class="field-input" autocomplete="current-password" />
          <p v-if="errorFor('password')" class="mt-1 text-sm text-red-600">{{ errorFor('password') }}</p>
        </div>
      </template>

      <!-- MFA / authenticator code -->
      <template v-else-if="component === 'ak-stage-authenticator-validate'">
        <div>
          <label class="field-label">Authentication code</label>
          <input v-model="model.code" inputmode="numeric" class="field-input" autocomplete="one-time-code" autofocus />
          <p v-if="errorFor('code')" class="mt-1 text-sm text-red-600">{{ errorFor('code') }}</p>
        </div>
      </template>

      <!-- Dynamic prompt stage (enrollment, extra fields, password set, ...) -->
      <template v-else-if="component === 'ak-stage-prompt'">
        <div v-for="field in challenge.fields" :key="field.field_key">
          <template v-if="field.type === 'static' || field.type === 'hidden'">
            <p v-if="field.type === 'static'" class="text-sm text-slate-600" v-html="field.initial_value" />
          </template>
          <template v-else-if="field.type === 'checkbox'">
            <label class="flex items-center gap-2 text-sm text-slate-700">
              <input v-model="model[field.field_key]" type="checkbox" class="rounded border-slate-300" />
              <span v-html="field.label" />
            </label>
          </template>
          <template v-else-if="field.type === 'dropdown'">
            <label class="field-label">{{ field.label }}</label>
            <select v-model="model[field.field_key]" class="field-input">
              <option v-for="choice in field.choices" :key="choice" :value="choice">{{ choice }}</option>
            </select>
          </template>
          <template v-else-if="field.type === 'text_area'">
            <label class="field-label">{{ field.label }}</label>
            <textarea v-model="model[field.field_key]" class="field-input" rows="3" :placeholder="field.placeholder" />
          </template>
          <template v-else>
            <label class="field-label">{{ field.label }}</label>
            <input
              v-model="model[field.field_key]"
              :type="inputType(field)"
              :placeholder="field.placeholder"
              :required="field.required"
              class="field-input"
            />
          </template>
          <p v-if="errorFor(field.field_key)" class="mt-1 text-sm text-red-600">{{ errorFor(field.field_key) }}</p>
        </div>
      </template>

      <!-- Email stage (e.g. recovery link sent) -->
      <template v-else-if="component === 'ak-stage-email'">
        <p class="text-sm text-slate-600">
          Check your inbox — we've sent you an email to continue.
        </p>
      </template>

      <!-- Anything we haven't styled yet: surface it so it's never a dead end. -->
      <template v-else>
        <p class="text-sm text-slate-600">
          Unsupported stage <code>{{ component }}</code>. Add a branch in FlowExecutor.vue.
        </p>
        <pre class="overflow-x-auto rounded-lg bg-slate-100 p-3 text-xs">{{ challenge }}</pre>
      </template>

      <button v-if="component !== 'ak-stage-email'" type="submit" class="btn-primary" :disabled="loading">
        {{ loading ? 'Please wait…' : 'Continue' }}
      </button>
    </form>

    <!-- Social / federated logins (authentik sources on the identification stage) -->
    <div
      v-if="component === 'ak-stage-identification' && challenge?.sources?.length"
      class="mt-6"
    >
      <div class="relative">
        <div class="absolute inset-0 flex items-center" aria-hidden="true">
          <div class="w-full border-t border-slate-200" />
        </div>
        <div class="relative flex justify-center">
          <span class="bg-white px-2 text-xs uppercase tracking-wide text-slate-400">
            or continue with
          </span>
        </div>
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        <button
          v-for="source in challenge.sources"
          :key="source.name"
          type="button"
          class="btn-social"
          :disabled="loading"
          @click="continueWithSource(source)"
        >
          <img v-if="source.icon_url" :src="source.icon_url" :alt="`${source.name} logo`" class="h-5 w-5" />
          <span>{{ source.name }}</span>
        </button>
      </div>
    </div>

    <!-- App-specific alternative sign-in paths (e.g. legacy migration), shown on
         the first/identification stage alongside the social buttons. -->
    <div v-if="$slots.alternatives && component === 'ak-stage-identification'" class="mt-6">
      <slot name="alternatives" />
    </div>

    <div class="mt-6 text-center text-sm text-slate-500">
      <slot name="footer" />
    </div>
  </div>
</template>
