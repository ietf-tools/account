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
