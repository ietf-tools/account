import type { FastifyRequest } from 'fastify'

import { config } from './config.ts'
import { errorMessage } from './errors.ts'
import type { Attributes } from './attributes.ts'

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

/**
 * The bits of an authentik user object this backend actually reads. It is a much
 * larger record than this — the index signature keeps the rest reachable (as
 * `unknown`) without pretending we know its shape, since which fields come back
 * depends on which serializer answered: `/core/users/me/` omits `attributes`
 * entirely, which is why the admin `getUser` exists at all.
 */
export interface AuthentikUser {
  pk: string | number
  username: string
  name?: string
  email?: string
  avatar?: string
  attributes?: Attributes
  [key: string]: unknown
}

/** A paginated authentik list response, as far as we read it. */
interface AuthentikListResponse {
  results?: AuthentikUser[]
}

/**
 * The acting browser's identity, forwarded to authentik so a server-side call is
 * attributed to the user rather than to this server — see clientHeaders.
 */
export interface ClientIdentity {
  ip?: string
  userAgent?: string
}

// Build the headers that make a server-side call carry the *end user's* client
// identity (their browser IP + User-Agent) instead of the backend's. Two reasons:
//   1. authentik logs events against the real client, not the app server.
//   2. authentik's session-binding sees a consistent origin — without this, a
//      replay of the user's session cookie from the backend's IP/UA looks like a
//      hijack and can terminate the session (the avatar/portrait bug).
// authentik only trusts the forwarded IP when the backend's own IP is a trusted
// proxy (AUTHENTIK_LISTEN__TRUSTED_PROXY_CIDRS); the User-Agent needs no trust.
// No-ops for any field we don't have.
function clientHeaders(client?: ClientIdentity): Record<string, string> {
  const headers: Record<string, string> = {}
  if (client?.ip) {
    headers['X-Forwarded-For'] = client.ip
  }
  if (client?.userAgent) {
    headers['User-Agent'] = client.userAgent
  }
  return headers
}

// Pull the acting browser's client identity off a Fastify request, to forward to
// authentik (see clientHeaders). `request.ip` is the real client IP only because
// the backend runs with `trustProxy` in production (see backend/index.ts); in dev
// it's the socket peer, which is the best we have and harmless.
export function clientFromRequest(request?: FastifyRequest): ClientIdentity {
  return { ip: request?.ip, userAgent: request?.headers?.['user-agent'] }
}

// Wrap fetch so a network/DNS failure surfaces as a clean 502 rather than a
// raw "fetch failed" 500.
async function doFetch(url: string, options?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, options)
  } catch (err) {
    throw new AuthentikError(`authentik is unreachable at ${config.authentik.url}`, 502, {
      cause: errorMessage(err)
    })
  }
}

// ── Admin API (service-account token) ────────────────────────────────────────

async function adminFetch(
  path: string,
  options: RequestInit = {},
  client?: ClientIdentity
): Promise<any> {
  if (!config.authentik.apiToken) {
    throw new AuthentikError('AUTHENTIK_API_TOKEN is not configured', 500)
  }
  const response = await doFetch(`${API}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.authentik.apiToken}`,
      // Attribute the resulting authentik event to the acting user's browser, not
      // the app server. Caller headers still win.
      ...clientHeaders(client),
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

export async function findUserByEmail(email: string): Promise<AuthentikUser | null> {
  const body: AuthentikListResponse = await adminFetch(
    `/core/users/?email=${encodeURIComponent(email)}`
  )
  return body.results?.[0] ?? null
}

export async function findUserByUsername(username: string): Promise<AuthentikUser | null> {
  const body: AuthentikListResponse = await adminFetch(
    `/core/users/?username=${encodeURIComponent(username)}`
  )
  return body.results?.find((u) => u.username === username) ?? null
}

export async function createUser({
  username,
  email,
  name,
  attributes = {}
}: {
  username: string
  email: string
  name?: string
  attributes?: Attributes
}): Promise<AuthentikUser> {
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

// `client` (optional) forwards the acting user's IP/User-Agent so the password
// change is logged against them — see clientHeaders.
export async function setUserPassword(
  userPk: string | number,
  password: string,
  client?: ClientIdentity
): Promise<void> {
  await adminFetch(
    `/core/users/${userPk}/set_password/`,
    {
      method: 'POST',
      body: JSON.stringify({ password })
    },
    client
  )
}

// Full admin view of a user, including `attributes` (the self serializer at
// /core/users/me/ omits them, so a PATCH that wants to preserve other attributes
// must read them from here first). `client` (optional): see clientHeaders.
export async function getUser(
  userPk: string | number,
  client?: ClientIdentity
): Promise<AuthentikUser> {
  return adminFetch(`/core/users/${userPk}/`, undefined, client)
}

// Partial update of a user. Note authentik REPLACES the `attributes` object
// wholesale on PATCH (it's a JSON field, not deep-merged) — callers that touch
// attributes must pass the full merged object. `client` (optional): see
// clientHeaders.
export async function patchUser(
  userPk: string | number,
  body: { email?: string; username?: string; name?: string; attributes?: Attributes },
  client?: ClientIdentity
): Promise<AuthentikUser> {
  return adminFetch(
    `/core/users/${userPk}/`,
    {
      method: 'PATCH',
      body: JSON.stringify(body)
    },
    client
  )
}

// ── Session identity (the browser's own authentik cookie, NOT the admin token) ──
//
// Resolve who is making a request by replaying the caller's authentik session
// cookie to /core/users/me/ — exactly the identity authentik itself would see.
// This is how avatar upload learns the acting user's pk securely: we never trust
// a pk sent from the browser, only the one authentik derives from its cookie.
// Returns the authentik user object, or null if the cookie resolves to an
// anonymous / absent session.
export async function resolveSessionUser(
  cookieHeader: string | undefined,
  client?: ClientIdentity
): Promise<AuthentikUser | null> {
  if (!cookieHeader) {
    return null
  }
  const response = await doFetch(`${API}/core/users/me/`, {
    headers: {
      Accept: 'application/json',
      Cookie: cookieHeader,
      // Replay the user's own IP/UA so authentik's session binding sees the same
      // client that created the session, not the backend — see clientHeaders.
      ...clientHeaders(client)
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
  const user: AuthentikUser | null = body?.user ?? body
  if (!user?.pk || user.username === 'AnonymousUser') {
    return null
  }
  return user
}

// Replay the caller's own authentik session cookie to a read-only API path and
// return the parsed JSON. Unlike adminFetch (service-account, sees everything)
// this is owner-scoped exactly as the SPA is: it answers "what does authentik
// show *this* user" — used to check whether the caller has a passkey / social
// login before we let them drop their password. Throws AuthentikError on a
// non-OK or non-JSON response.
//
// The parsed JSON comes back untyped (`any`): the shape depends entirely on
// `path`, so callers declare the slice of it they read.
export async function userApiGet(
  cookieHeader: string | undefined,
  path: string,
  client?: ClientIdentity
): Promise<any> {
  if (!cookieHeader) {
    throw new AuthentikError('Not authenticated', 401)
  }
  const response = await doFetch(`${API}${path}`, {
    headers: {
      Accept: 'application/json',
      Cookie: cookieHeader,
      // As in resolveSessionUser: replay the user's own IP/UA so session binding
      // sees a consistent client — see clientHeaders.
      ...clientHeaders(client)
    },
    // As in resolveSessionUser: an invalid session can 302 to authentik's HTML
    // login flow — don't follow that into a non-JSON page.
    redirect: 'manual'
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  if (!response.ok || body == null) {
    throw new AuthentikError(
      body?.detail || `authentik API error (HTTP ${response.status})`,
      response.ok ? 502 : response.status,
      body
    )
  }
  return body
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class AuthentikError extends Error {
  status: number
  detail: unknown

  constructor(message: string, status = 502, detail: unknown = null) {
    super(message)
    this.name = 'AuthentikError'
    this.status = status
    this.detail = detail
  }
}
