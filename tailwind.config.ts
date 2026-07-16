import type { Config } from 'tailwindcss'

export default <Partial<Config>>{
  darkMode: 'class',
  content: [
    './frontend/components/**/*.{vue,js,ts}',
    './frontend/layouts/**/*.vue',
    './frontend/pages/**/*.vue',
    './frontend/app.vue'
  ],
  theme: {
    extend: {}
  }
}
