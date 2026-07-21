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
// with authentik's /api at the domain root. It's used only for custom features
// (the legacy migration) — auth flows go straight to authentik.
const apiUrl = process.env.NUXT_PUBLIC_API_URL ?? `${baseURL.replace(/\/+$/, '')}/api`

// authentik's own API. In production the SPA and authentik share account.ietf.org,
// so this is same-origin at the domain root (/api/v3) and the browser drives the
// Flow Executor directly. In dev it's proxied below to the remote authentik.
const authentikApiUrl = process.env.NUXT_PUBLIC_AUTHENTIK_API_URL ?? '/api/v3'

// Flow slugs the SPA drives directly. Same env vars the backend used to read, so
// there's one source of truth; these are the authentik defaults.
const flows = {
  authentication: process.env.AUTHENTIK_FLOW_AUTHENTICATION ?? 'ietf-login',
  enrollment: process.env.AUTHENTIK_FLOW_ENROLLMENT ?? 'ietf-enrollment',
  recovery: process.env.AUTHENTIK_FLOW_RECOVERY ?? 'ietf-recovery',
  // Source callback flow: what authentik runs when the browser returns from a
  // social/OAuth source. Usually completes non-interactively and redirects to
  // `next`; when it needs interactive stages (first-time enrollment, account
  // linking, missing attributes) authentik would render its own UI at
  // /if/flow/ietf-social-callback/ — a Cloudflare rule sends that to
  // /app/social-callback, where the SPA drives it (see social-callback.vue).
  socialCallback: process.env.AUTHENTIK_FLOW_SOCIAL_CALLBACK ?? 'ietf-social-callback',
  // Source enrollment flow: what authentik runs to CREATE the account the first
  // time a user returns from a social source. It has no interactive prompt, so
  // authentik would just flash its own UI at /if/flow/ietf-social-enrollment/
  // before redirecting — a Cloudflare rule sends that to /app/social-enrollment,
  // where the SPA shows a "finalizing" screen while the flow completes (see
  // social-enrollment.vue).
  socialEnrollment: process.env.AUTHENTIK_FLOW_SOCIAL_ENROLLMENT ?? 'ietf-social-enrollment',
  // Brand default invalidation flow: the actual logout (a user_logout stage). The
  // account shell drives this to sign the user out of authentik (see auth store's
  // logout()). This is the flow whose URL authentik hands back as
  // invalidation_flow_url on the provider session-end screen below.
  invalidation: process.env.AUTHENTIK_FLOW_INVALIDATION ?? 'ietf-invalidation',
  // Provider invalidation flow: the one authentik runs when an app logs the user
  // out (its slug is set as a provider's "Invalidation flow"). It ends on an
  // ak-stage-session-end challenge — the "you've been signed out of <app>" screen
  // with options to return, log back in, or fully sign out. The SPA drives this
  // one (see logout.vue). NOT to be confused with the brand's default invalidation
  // flow (the actual logout), whose URL authentik hands back on that challenge.
  providerInvalidation:
    process.env.AUTHENTIK_FLOW_PROVIDER_INVALIDATION ?? 'ietf-provider-invalidation',
  userSettings: process.env.AUTHENTIK_FLOW_USER_SETTINGS ?? 'ietf-user-settings',
  passwordChange: process.env.AUTHENTIK_FLOW_PASSWORD_CHANGE ?? 'ietf-password-change',
  // Authenticator (MFA) enrollment flows, one per device type.
  totpSetup: process.env.AUTHENTIK_FLOW_TOTP_SETUP ?? 'default-authenticator-totp-setup',
  webauthnSetup: process.env.AUTHENTIK_FLOW_WEBAUTHN_SETUP ?? 'default-authenticator-webauthn-setup',
  staticSetup: process.env.AUTHENTIK_FLOW_STATIC_SETUP ?? 'default-authenticator-static-setup'
}

// Dev only: base URL of the remote authentik to proxy /api/v3 to. In production
// this is unused (same-origin). Reuses AUTHENTIK_URL from the backend's .env.
const devAuthentikUrl = (process.env.AUTHENTIK_URL ?? '').replace(/\/+$/, '')

export default defineNuxtConfig({
  compatibilityDate: '2026-06-28',
  srcDir: 'frontend/',
  ssr: false,
  modules: ['@nuxtjs/tailwindcss', '@pinia/nuxt'],
  runtimeConfig: {
    public: {
      apiUrl,
      authentikApiUrl,
      flows,
      appVersion
    }
  },
  css: ['~/assets/css/main.css'],
  devServer: {
    port: 3000
  },
  nitro: {
    devProxy: {
      // authentik's API -> remote authentik (only when AUTHENTIK_URL is set).
      // In dev the browser is on localhost, so proxying keeps flow calls
      // same-origin. Note: social login still can't complete in dev, and if
      // authentik sets Secure cookies they won't stick over http://localhost —
      // test full sign-in against the deployed same-host environment.
      ...(devAuthentikUrl
        ? {
            [authentikApiUrl]: {
              target: `${devAuthentikUrl}/api/v3`,
              changeOrigin: true,
              cookieDomainRewrite: 'localhost'
            },
            // authentik's browser flow views (e.g. /flows/-/cancel/, used to
            // restart a flow) live at the root, not under /api/v3.
            '/flows': {
              target: `${devAuthentikUrl}/flows`,
              changeOrigin: true,
              cookieDomainRewrite: 'localhost'
            }
          }
        : {}),
      // The app's own backend (migration).
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
