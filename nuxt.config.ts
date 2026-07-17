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
      title: 'IETF Account',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
      // The app is a JS-only SPA (ssr: false), so with JavaScript disabled the
      // page renders nothing. Show a self-contained warning (inline styles, no
      // class/JS dependency) at the top of <body> so it's visible in the static
      // shell before hydration.
      noscript: [
        {
          tagPosition: 'bodyOpen',
          innerHTML:
            '<div style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;background:#020617;color:#e2e8f0;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;text-align:center;">' +
            '<div style="max-width:28rem;">' +
            '<h1 style="margin:0 0 .5rem;font-size:1.25rem;font-weight:600;">JavaScript is required</h1>' +
            '<p style="margin:0;font-size:.875rem;line-height:1.5;color:#94a3b8;">The IETF Account portal needs JavaScript to sign you in. Please enable JavaScript in your browser settings and reload this page to continue.</p>' +
            '</div></div>'
        }
      ]
    }
  }
})
