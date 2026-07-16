import { config } from './config.js'

/**
 * Headless authentik client.
 *
 * authentik has no "login API" in the traditional sense. Instead every
 * interactive flow (authentication, enrollment, recovery, ...) is a state
 * machine driven through the **Flow Executor** API:
 *
 *   GET  /api/v3/flows/executor/<slug>/   -> returns the current "challenge"
 *   POST /api/v3/flows/executor/<slug>/   -> submits a response, returns the next challenge
 *
 * A challenge is a JSON object describing a stage to render, keyed by
 * `component` (e.g. `ak-stage-identification`, `ak-stage-password`,
 * `ak-stage-prompt`). The flow completes when it returns the terminal
 * `xak-flow-redirect` component.
 *
 * Flow state is tracked entirely through cookies that authentik sets on the
 * executor responses. We keep a per-browser-session cookie jar (persisted in
 * the Fastify session) and replay it on every request so the flow advances
 * correctly. This module is transport only — it holds no state of its own.
 */

const API = `${config.authentik.url}/api/v3`

// ── Cookie jar helpers ───────────────────────────────────────────────────────
// A "jar" is a plain `{ name: value }` map, safe to store in a session.

export function newJar() {
  return {}
}

function absorbCookies(jar, response) {
  // Node's fetch exposes multiple Set-Cookie headers via getSetCookie().
  const setCookies = response.headers.getSetCookie?.() ?? []
  for (const raw of setCookies) {
    const [pair] = raw.split(';')
    const idx = pair.indexOf('=')
    if (idx === -1) continue
    const name = pair.slice(0, idx).trim()
    const value = pair.slice(idx + 1).trim()
    // A cookie set to empty/expired is a deletion.
    if (value === '' || value === '""') delete jar[name]
    else jar[name] = value
  }
  return jar
}

function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

// Wrap fetch so a network/DNS failure surfaces as a clean 502 rather than a
// raw "fetch failed" 500.
async function doFetch(url, options) {
  try {
    return await fetch(url, options)
  } catch (err) {
    throw new AuthentikError(`authentik is unreachable at ${config.authentik.url}`, 502, {
      cause: err.message
    })
  }
}

// ── Flow executor ────────────────────────────────────────────────────────────

function executorUrl(flowSlug, query = '') {
  const qs = query ? `?query=${encodeURIComponent(query)}` : '?query='
  return `${API}/flows/executor/${flowSlug}/${qs}`
}

/**
 * Begin (or restart) a flow. Returns `{ challenge, jar }`.
 * The returned jar must be persisted and passed back to `advanceFlow`.
 */
export async function beginFlow(flowSlug) {
  const jar = newJar()
  const response = await doFetch(executorUrl(flowSlug), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      // authentik/Django CSRF checks Origin/Referer on unsafe requests; since
      // we drive the flow server-side we present the authentik origin itself.
      Referer: `${config.authentik.url}/`
    }
  })
  absorbCookies(jar, response)
  const challenge = await parseChallenge(response, flowSlug)
  return { challenge, jar }
}

/**
 * Submit a response to the current challenge. `payload` is the raw object the
 * stage expects (e.g. `{ uid_field, password }` or dynamic prompt fields).
 * Returns the next `{ challenge, jar }`.
 */
export async function advanceFlow(flowSlug, jar, payload) {
  const response = await doFetch(executorUrl(flowSlug), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Referer: `${config.authentik.url}/`,
      // authentik sets this cookie; echo it back as the CSRF header.
      'X-authentik-CSRF': jar.authentik_csrf ?? '',
      Cookie: cookieHeader(jar)
    },
    body: JSON.stringify(payload ?? {})
  })
  absorbCookies(jar, response)
  const challenge = await parseChallenge(response, flowSlug)
  return { challenge, jar }
}

async function parseChallenge(response, flowSlug) {
  let body
  try {
    body = await response.json()
  } catch {
    throw new AuthentikError(
      `Flow "${flowSlug}" returned a non-JSON response (HTTP ${response.status}). ` +
        `Check AUTHENTIK_URL and that the flow slug exists.`,
      response.status
    )
  }
  return body
}

/** A flow is finished (and successful) when it hands back a redirect. */
export function isFlowComplete(challenge) {
  return challenge?.component === 'xak-flow-redirect'
}

// ── Authenticated calls on behalf of a logged-in user ────────────────────────

/**
 * Fetch the profile of the user whose session lives in `jar`. Call this right
 * after a flow completes to capture who just logged in / enrolled.
 */
export async function getCurrentUser(jar) {
  const response = await doFetch(`${API}/core/users/me/`, {
    headers: {
      Accept: 'application/json',
      Cookie: cookieHeader(jar)
    }
  })
  if (!response.ok) {
    throw new AuthentikError('Could not resolve the current user session', response.status)
  }
  const body = await response.json()
  return body.user ?? body
}

/** End the authentik session tied to this jar. */
export async function logout(jar) {
  await fetch(`${API}/flows/executor/default-invalidation-flow/?query=`, {
    headers: { Accept: 'application/json', Cookie: cookieHeader(jar) }
  }).catch(() => {})
}

// ── Admin API (service-account token) ────────────────────────────────────────
// Used by backend-only flows such as the legacy account migration.

async function adminFetch(path, options = {}) {
  if (!config.authentik.apiToken) {
    throw new AuthentikError('AUTHENTIK_API_TOKEN is not configured', 500)
  }
  const response = await doFetch(`${API}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.authentik.apiToken}`,
      ...options.headers
    }
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new AuthentikError(
      body?.detail || `authentik admin API error (HTTP ${response.status})`,
      response.status,
      body
    )
  }
  return body
}

export async function findUserByEmail(email) {
  const body = await adminFetch(`/core/users/?email=${encodeURIComponent(email)}`)
  return body.results?.[0] ?? null
}

export async function findUserByUsername(username) {
  const body = await adminFetch(`/core/users/?username=${encodeURIComponent(username)}`)
  return body.results?.find((u) => u.username === username) ?? null
}

export async function createUser({ username, email, name, attributes = {} }) {
  return adminFetch('/core/users/', {
    method: 'POST',
    body: JSON.stringify({
      username,
      email,
      name: name || username,
      is_active: true,
      type: 'internal',
      attributes
    })
  })
}

export async function setUserPassword(userPk, password) {
  await adminFetch(`/core/users/${userPk}/set_password/`, {
    method: 'POST',
    body: JSON.stringify({ password })
  })
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class AuthentikError extends Error {
  constructor(message, status = 502, detail = null) {
    super(message)
    this.name = 'AuthentikError'
    this.status = status
    this.detail = detail
  }
}
