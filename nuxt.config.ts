import { readFileSync } from 'node:fs'

const appVersion =
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')).version || '0.0.0'

// During `nuxt dev` the frontend runs on :3000 and the Fastify backend on :4000.
// We proxy the API path -> backend so the browser only ever talks to one origin
// (avoids CORS + cross-site cookie headaches). In production the built SPA is
// served by the backend itself, so the API is same-origin there too.
const backendUrl = process.env.NUXT_BACKEND_URL ?? 'http://localhost:4000'

// Deployed under https://account.ietf.org/app/ — authentik owns the domain root,
// so the SPA is served from, and all links/assets resolve against, /app/.
// Override with NUXT_APP_BASE_URL to mount elsewhere (e.g. "/" for a standalone
// deployment).
const baseURL = process.env.NUXT_APP_BASE_URL ?? '/app/'

// The app's own API lives under the app base (…/app/api) so it never collides
// with authentik's /api at the domain root.
const apiUrl = process.env.NUXT_PUBLIC_API_URL ?? `${baseURL.replace(/\/+$/, '')}/api`

export default defineNuxtConfig({
  compatibilityDate: '2026-06-28',
  srcDir: 'frontend/',
  ssr: false,
  modules: ['@nuxtjs/tailwindcss', '@pinia/nuxt'],
  runtimeConfig: {
    public: {
      apiUrl,
      appVersion
    }
  },
  css: ['~/assets/css/main.css'],
  devServer: {
    port: 3000
  },
  nitro: {
    devProxy: {
      [apiUrl]: {
        target: `${backendUrl}/api`,
        changeOrigin: true,
        cookieDomainRewrite: 'localhost'
      }
    }
  },
  app: {
    baseURL,
    head: {
      title: 'Authentik UI',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
      // Apply the persisted (or system) theme before first paint so there's no
      // flash of the wrong theme. useTheme() takes over once the app boots.
      script: [
        {
          innerHTML: `(function(){try{var p=localStorage.getItem('ietf-theme');var d=p==='dark'||((p==='system'||!p)&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})()`
        }
      ]
    }
  }
})
