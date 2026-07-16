<script setup>
// Top-right theme switcher: an icon button that opens a small menu to choose
// between System, Light and Dark. The current preference drives the button
// icon; selecting an option persists it via useTheme().
const { preference, setPreference } = useTheme()

const open = ref(false)
const rootEl = ref(null)

const items = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

// The three theme glyphs, shared between the trigger button and the menu rows.
// system = half light / half dark, light = sun, dark = moon.
const ThemeIcon = (props) => {
  const svg = {
    system: [
      h('circle', { cx: 12, cy: 12, r: 9, fill: 'none' }),
      h('path', { d: 'M12 3a9 9 0 010 18z', fill: 'currentColor', stroke: 'none' })
    ],
    light: [
      h('circle', { cx: 12, cy: 12, r: 4, fill: 'none' }),
      h('path', {
        'stroke-linecap': 'round',
        d: 'M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4l1.4-1.4'
      })
    ],
    dark: [
      h('path', {
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        fill: 'none',
        d: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z'
      })
    ]
  }
  return h(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      class: props.class ?? 'h-5 w-5',
      viewBox: '0 0 24 24',
      stroke: 'currentColor',
      'stroke-width': 1.7
    },
    svg[props.name]
  )
}

function choose(value) {
  setPreference(value)
  open.value = false
}

function onClickOutside(event) {
  if (rootEl.value && !rootEl.value.contains(event.target)) {
    open.value = false
  }
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    open.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', onClickOutside)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="rootEl" class="relative">
    <button
      type="button"
      class="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 transition
        hover:text-slate-200"
      :aria-label="`Theme: ${preference}`"
      title="Color Theme"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click="open = !open"
    >
      <ThemeIcon :name="preference" />
    </button>

    <div
      v-if="open"
      role="menu"
      class="absolute right-0 mt-2 w-36 overflow-hidden rounded-lg border border-slate-200 bg-white
        py-1 shadow-lg ring-1 ring-slate-900/5 dark:border-slate-700 dark:bg-slate-800 dark:ring-white/10"
    >
      <button
        v-for="item in items"
        :key="item.value"
        type="button"
        role="menuitemradio"
        :aria-checked="preference === item.value"
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700
          hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
        @click="choose(item.value)"
      >
        <ThemeIcon :name="item.value" class="h-4 w-4 shrink-0" />
        <span>{{ item.label }}</span>
        <svg
          v-if="preference === item.value"
          xmlns="http://www.w3.org/2000/svg"
          class="ml-auto h-4 w-4 text-sky-600 dark:text-sky-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </button>
    </div>
  </div>
</template>
