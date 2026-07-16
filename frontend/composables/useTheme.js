// Theme preference: 'system' | 'light' | 'dark'.
//
// The preference is persisted to localStorage and applied as a `dark` class on
// <html> (Tailwind runs in darkMode: 'class'). 'system' tracks the OS setting
// live via matchMedia, so flipping the OS theme updates the app without a
// reload. An inline head script (see nuxt.config.ts) applies the same class
// before first paint to avoid a flash of the wrong theme; this composable then
// takes over reactivity once the app boots.
const STORAGE_KEY = 'ietf-theme'
const OPTIONS = ['system', 'light', 'dark']

// Module-level singletons so every caller shares one source of truth.
const preference = ref('system')
const systemDark = ref(false)
let initialized = false

function resolve(pref) {
  if (pref === 'system') {
    return systemDark.value ? 'dark' : 'light'
  }
  return pref
}

function apply() {
  document.documentElement.classList.toggle('dark', resolve(preference.value) === 'dark')
}

export function useTheme() {
  if (import.meta.client && !initialized) {
    initialized = true

    const stored = localStorage.getItem(STORAGE_KEY)
    if (OPTIONS.includes(stored)) {
      preference.value = stored
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    systemDark.value = mediaQuery.matches
    mediaQuery.addEventListener('change', (e) => {
      systemDark.value = e.matches
      if (preference.value === 'system') {
        apply()
      }
    })

    apply()
  }

  function setPreference(value) {
    if (!OPTIONS.includes(value)) {
      return
    }
    preference.value = value
    if (import.meta.client) {
      localStorage.setItem(STORAGE_KEY, value)
      apply()
    }
  }

  const resolvedTheme = computed(() => resolve(preference.value))

  return { preference, resolvedTheme, setPreference, options: OPTIONS }
}
