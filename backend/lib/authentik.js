import { config } from './config.js'

/**
 * authentik admin client — the *only* part of authentik the backend still talks
 * to. Interactive auth flows (authentication, enrollment, recovery) are driven
 * by the browser directly against authentik's Flow Executor (see the frontend's
 * useFlow/useAuthentik); the backend is not in that path.
 *
 * What remains here is the service-account API used by backend-only features —
 * currently just the legacy account migration — which needs an admin token that
 * must never reach the browser.
 */

const API = `${config.authentik.url}/api/v3`

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

// ── Admin API (service-account token) ────────────────────────────────────────

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
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // Non-JSON (e.g. an HTML error page from a proxy in front of authentik).
    body = null
  }
  if (!response.ok) {
    // Surface which admin call was denied — e.g. a 403 "You do not have
    // permission to perform this action." means the service account behind
    // AUTHENTIK_API_TOKEN lacks the needed user view/change permission.
    console.warn(
      `authentik admin API ${options.method ?? 'GET'} ${path} -> HTTP ${response.status}` +
        `${body?.detail ? `: ${body.detail}` : ''}`
    )
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

// Full admin view of a user, including `attributes` (the self serializer at
// /core/users/me/ omits them, so a PATCH that wants to preserve other attributes
// must read them from here first).
export async function getUser(userPk) {
  return adminFetch(`/core/users/${userPk}/`)
}

// Partial update of a user. Note authentik REPLACES the `attributes` object
// wholesale on PATCH (it's a JSON field, not deep-merged) — callers that touch
// attributes must pass the full merged object.
export async function patchUser(userPk, body) {
  return adminFetch(`/core/users/${userPk}/`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  })
}

// ── Session identity (the browser's own authentik cookie, NOT the admin token) ──
//
// Resolve who is making a request by replaying the caller's authentik session
// cookie to /core/users/me/ — exactly the identity authentik itself would see.
// This is how avatar upload learns the acting user's pk securely: we never trust
// a pk sent from the browser, only the one authentik derives from its cookie.
// Returns the authentik user object, or null if the cookie resolves to an
// anonymous / absent session.
export async function resolveSessionUser(cookieHeader) {
  if (!cookieHeader) {
    return null
  }
  const response = await doFetch(`${API}/core/users/me/`, {
    headers: {
      Accept: 'application/json',
      Cookie: cookieHeader
    },
    // An unrecognised/expired session can bounce to authentik's HTML login flow;
    // don't follow that into an HTML page — treat a redirect as "no session".
    redirect: 'manual'
  })
  if (!response.ok) {
    return null
  }
  // authentik's API returns JSON. Anything else (an HTML login/error page, e.g.
  // when the forwarded cookie isn't a valid session) means we couldn't resolve a
  // user — return null instead of throwing on JSON.parse. Warn so a genuine
  // misconfiguration (wrong AUTHENTIK_URL, non-JSON 200) is visible in the logs.
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    console.warn(
      `resolveSessionUser: expected JSON from ${API}/core/users/me/ but got ` +
        `${response.headers.get('content-type') || 'unknown'} (HTTP ${response.status}). ` +
        'Treating as no session.'
    )
    return null
  }
  const user = body?.user ?? body
  if (!user?.pk || user.username === 'AnonymousUser') {
    return null
  }
  return user
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
