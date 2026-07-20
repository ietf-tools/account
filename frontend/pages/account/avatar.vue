<script setup>
// Two related pictures on one view:
//   • Avatar   — Gravatar or a square uploaded picture (useAvatar).
//   • Portrait — an optional higher-res, full-frame photo, upload-only
//                (usePortrait).
// Both post to the app backend, which stores uploads in object storage and
// records their URL on the authentik user (see the composables / backend routes).
definePageMeta({ middleware: 'auth', layout: 'account' })

const auth = useAuthStore()

// ── Avatar ───────────────────────────────────────────────────────────────────
const {
  mode,
  current: avatarCurrent,
  gravatar,
  uploaded,
  loading: avatarLoading,
  saving: avatarSaving,
  error: avatarError,
  saved: avatarSaved,
  usingSample: avatarSample,
  load: loadAvatar,
  upload: uploadAvatar,
  useGravatar,
  useInitials
} = useAvatar()

// Which source the user is currently looking at; seeded from the active mode.
const selected = ref('gravatar')

const avatarInput = ref(null)
const avatarPending = ref(null)
const avatarPreview = ref(null)

const avatarPreviewSrc = computed(() => {
  if (selected.value === 'upload') {
    return avatarPreview.value || uploaded.value || avatarCurrent.value
  }
  if (selected.value === 'initials') {
    // Only preview the real generated image once it's the active mode; otherwise
    // fall through to the letter placeholder below.
    return mode.value === 'initials' ? avatarCurrent.value : null
  }
  return gravatar.value || avatarCurrent.value
})

const initial = computed(() => {
  const source = auth.user?.name || auth.user?.username || '?'
  return source.charAt(0).toUpperCase()
})

function readInto(file, target) {
  const reader = new FileReader()
  reader.onload = () => {
    target.value = reader.result
  }
  reader.readAsDataURL(file)
}

function clearAvatarSelection() {
  avatarPending.value = null
  avatarPreview.value = null
  if (avatarInput.value) {
    avatarInput.value.value = ''
  }
}

function onAvatarFile(event) {
  const file = event.target.files?.[0] ?? null
  avatarPending.value = file
  avatarPreview.value = null
  if (file) {
    readInto(file, avatarPreview)
  }
}

async function onSaveAvatar() {
  if (!avatarPending.value) {
    return
  }
  if (await uploadAvatar(avatarPending.value)) {
    clearAvatarSelection()
  }
}

async function onUseGravatar() {
  if (await useGravatar()) {
    clearAvatarSelection()
  }
}

async function onUseInitials() {
  if (await useInitials()) {
    clearAvatarSelection()
  }
}

// ── Portrait ─────────────────────────────────────────────────────────────────
const {
  current: portraitCurrent,
  loading: portraitLoading,
  saving: portraitSaving,
  error: portraitError,
  saved: portraitSaved,
  usingSample: portraitSample,
  load: loadPortrait,
  upload: uploadPortrait,
  remove: removePortrait
} = usePortrait()

const portraitInput = ref(null)
const portraitPending = ref(null)
const portraitPreview = ref(null)

const portraitPreviewSrc = computed(() => portraitPreview.value || portraitCurrent.value)

function clearPortraitSelection() {
  portraitPending.value = null
  portraitPreview.value = null
  if (portraitInput.value) {
    portraitInput.value.value = ''
  }
}

function onPortraitFile(event) {
  const file = event.target.files?.[0] ?? null
  portraitPending.value = file
  portraitPreview.value = null
  if (file) {
    readInto(file, portraitPreview)
  }
}

async function onSavePortrait() {
  if (!portraitPending.value) {
    return
  }
  if (await uploadPortrait(portraitPending.value)) {
    clearPortraitSelection()
  }
}

async function onRemovePortrait() {
  if (await removePortrait()) {
    clearPortraitSelection()
  }
}

onMounted(async () => {
  await Promise.all([loadAvatar(), loadPortrait()])
  selected.value = mode.value
})
</script>

<template>
  <div>
    <TabHeader
      title="Avatar / Portrait"
      subtitle="Your avatar and an optional full portrait picture."
    />

    <div
      v-if="avatarSample || portraitSample"
      class="mb-6 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700"
    >
      Showing a local preview (dev) — no live authentik session, so nothing was saved.
    </div>

    <!-- ── Avatar ─────────────────────────────────────────────────────────── -->
    <section>
      <h2 class="text-base font-semibold text-slate-900">Avatar</h2>
      <p class="mt-1 text-sm text-slate-500">
        A small, square picture shown across your account and other apps.
      </p>

      <div v-if="avatarSaved" class="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
        Your avatar has been updated.
      </div>
      <div v-if="avatarError" class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {{ avatarError }}
      </div>

      <LoadingState v-if="avatarLoading" text="Loading your avatar…" />

      <div v-else class="mt-4 flex flex-col items-start gap-6 sm:flex-row">
        <div class="flex w-28 shrink-0 flex-col items-center gap-2">
          <img
            v-if="avatarPreviewSrc"
            :src="avatarPreviewSrc"
            alt="Avatar preview"
            class="h-28 w-28 rounded-full object-cover ring-1 ring-slate-200"
          />
          <span
            v-else
            aria-hidden="true"
            class="flex h-28 w-28 items-center justify-center rounded-full bg-sky-100
              text-3xl font-semibold text-sky-700"
          >
            {{ initial }}
          </span>
          <span class="text-xs text-slate-400">Preview</span>
        </div>

        <div class="min-w-0 flex-1 space-y-4">
          <fieldset class="space-y-2">
            <legend class="field-label">Avatar source</legend>
            <div class="grid grid-cols-1 gap-2">
              <label
                class="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition"
                :class="
                  selected === 'gravatar'
                    ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-500'
                    : 'border-slate-300 hover:bg-slate-50'
                "
              >
                <input v-model="selected" type="radio" value="gravatar" class="mt-0.5 accent-sky-600" />
                <span class="min-w-0">
                  <span class="block font-medium text-slate-900">Gravatar</span>
                  <span class="block text-xs text-slate-500">Uses the image linked to your email.</span>
                </span>
              </label>

              <label
                class="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition"
                :class="
                  selected === 'initials'
                    ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-500'
                    : 'border-slate-300 hover:bg-slate-50'
                "
              >
                <input v-model="selected" type="radio" value="initials" class="mt-0.5 accent-sky-600" />
                <span class="min-w-0">
                  <span class="block font-medium text-slate-900">Use initials</span>
                  <span class="block text-xs text-slate-500">Your initials on a colored background.</span>
                </span>
              </label>

              <label
                class="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition"
                :class="
                  selected === 'upload'
                    ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-500'
                    : 'border-slate-300 hover:bg-slate-50'
                "
              >
                <input v-model="selected" type="radio" value="upload" class="mt-0.5 accent-sky-600" />
                <span class="min-w-0">
                  <span class="block font-medium text-slate-900">Upload a picture</span>
                  <span class="block text-xs text-slate-500">PNG, JPEG or WebP, up to 10&nbsp;MB.</span>
                </span>
              </label>
            </div>
          </fieldset>

          <div v-if="selected === 'gravatar'" class="space-y-2">
            <p class="text-sm text-slate-500">
              Your avatar will use
              <a href="https://gravatar.com" target="_blank" rel="noopener" class="link">Gravatar</a>,
              based on {{ auth.user?.email }}.
            </p>
            <button
              type="button"
              class="btn-primary w-auto px-4"
              :disabled="avatarSaving || mode === 'gravatar'"
              @click="onUseGravatar"
            >
              {{ avatarSaving ? 'Saving…' : mode === 'gravatar' ? 'Using Gravatar' : 'Use Gravatar' }}
            </button>
          </div>

          <div v-else-if="selected === 'initials'" class="space-y-2">
            <p class="text-sm text-slate-500">
              Your avatar will show your initials on a colored background, generated from your name.
            </p>
            <button
              type="button"
              class="btn-primary w-auto px-4"
              :disabled="avatarSaving || mode === 'initials'"
              @click="onUseInitials"
            >
              {{ avatarSaving ? 'Saving…' : mode === 'initials' ? 'Using initials' : 'Use initials' }}
            </button>
          </div>

          <div v-else class="space-y-3">
            <p class="text-sm text-slate-500">
              Images are cropped to a square and resized before saving.
            </p>

            <input
              ref="avatarInput"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              class="hidden"
              @change="onAvatarFile"
            />

            <div class="flex flex-wrap items-center gap-2">
              <button type="button" class="btn-social w-auto" @click="avatarInput?.click()">
                Choose image…
              </button>
              <span v-if="avatarPending" class="truncate text-xs text-slate-500">
                {{ avatarPending.name }}
              </span>
            </div>

            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="btn-primary w-auto px-4"
                :disabled="avatarSaving || !avatarPending"
                @click="onSaveAvatar"
              >
                {{ avatarSaving ? 'Saving…' : 'Save avatar' }}
              </button>
              <button
                v-if="avatarPending"
                type="button"
                class="btn-social w-auto"
                :disabled="avatarSaving"
                @click="clearAvatarSelection"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Portrait ───────────────────────────────────────────────────────── -->
    <section class="mt-8 border-t border-slate-200 pt-8">
      <h2 class="text-base font-semibold text-slate-900">Portrait Picture</h2>
      <p class="mt-1 text-sm text-slate-500">
        An optional higher-resolution photo of yourself, shown on your Datatracker public profile.
      </p>

      <div v-if="portraitSaved" class="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
        Your portrait has been updated.
      </div>
      <div v-if="portraitError" class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {{ portraitError }}
      </div>

      <LoadingState v-if="portraitLoading" text="Loading your portrait…" />

      <div v-else class="mt-4 flex flex-col items-start gap-6 sm:flex-row">
        <div class="flex w-28 shrink-0 flex-col items-center gap-2">
          <img
            v-if="portraitPreviewSrc"
            :src="portraitPreviewSrc"
            alt="Portrait preview"
            class="max-h-56 w-full rounded-lg object-contain ring-1 ring-slate-200"
          />
          <div
            v-else
            class="flex h-40 w-full items-center justify-center rounded-lg border border-dashed
              border-slate-300 bg-slate-50 px-2 text-center text-xs text-slate-400"
          >
            No portrait uploaded
          </div>
          <span class="text-xs text-slate-400">Preview</span>
        </div>

        <div class="min-w-0 flex-1 space-y-3">
          <p class="text-sm text-slate-500">
            PNG, JPEG or WebP, up to 15&nbsp;MB. Resized on upload; aspect ratio is kept, up to a maximum edge of 1600px (cropped otherwise).
          </p>

          <input
            ref="portraitInput"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            class="hidden"
            @change="onPortraitFile"
          />

          <div class="flex flex-wrap items-center gap-2">
            <button type="button" class="btn-social w-auto" @click="portraitInput?.click()">
              Choose image…
            </button>
            <span v-if="portraitPending" class="truncate text-xs text-slate-500">
              {{ portraitPending.name }}
            </span>
          </div>

          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="btn-primary w-auto px-4"
              :disabled="portraitSaving || !portraitPending"
              @click="onSavePortrait"
            >
              {{ portraitSaving ? 'Saving…' : 'Save portrait' }}
            </button>
            <button
              v-if="portraitPending"
              type="button"
              class="btn-social w-auto"
              :disabled="portraitSaving"
              @click="clearPortraitSelection"
            >
              Cancel
            </button>
            <button
              v-if="portraitCurrent && !portraitPending"
              type="button"
              class="btn-social w-auto text-red-600"
              :disabled="portraitSaving"
              @click="onRemovePortrait"
            >
              Remove
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
