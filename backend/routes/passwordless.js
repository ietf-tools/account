import { randomBytes } from 'node:crypto'

import {
  resolveSessionUser,
  userApiGet,
  setUserPassword,
  clientFromRequest,
  AuthentikError
} from '../lib/authentik.js'

/**
 * "Go passwordless" — let a signed-in user drop the password from their account
 * once they have another way in (a passkey or a linked social login).
 *
 * Like migration/avatar this is a backend-only feature: it needs the admin API
 * token to change the password, so it can't run browser-direct the way the auth
 * flows do. We identify the caller from their authentik session cookie (never a
 * pk from the browser), re-check server-side that they still have a passkey or
 * social login (so they can't lock themselves out), then blank the password.
 *
 * On "blank": authentik's API has no way to store a Django *unusable* password on
 * an existing regular user — `set_password` always hashes a usable value,
 * `set_password_hash` rejects the unusable "!" prefix, and the directly-writable
 * password field is blueprint-context only. So we set a long random password the
 * user is never shown: their old password stops working and they sign in with the
 * passkey / social login from here on. (They can still use account recovery to
 * set a new one later.)
 */
export default async function passwordlessRoutes(app) {
  // Resolve the acting user from their authentik session cookie, or reply 401.
  async function requireCaller(request, reply) {
    let user = null
    try {
      user = await resolveSessionUser(request.headers.cookie, clientFromRequest(request))
    } catch (err) {
      if (err instanceof AuthentikError) {
        reply.code(err.status ?? 502).send({ error: err.message })
        return null
      }
      throw err
    }
    if (!user) {
      reply.unauthorized('You must be signed in to change your password settings')
      return null
    }
    return user
  }

  // What passwordless sign-in methods does the caller have? We replay their own
  // cookie so these are owner-scoped exactly as their own account pages see them.
  async function passwordlessMethods(cookieHeader, user, client) {
    const [devicesBody, connsBody] = await Promise.all([
      userApiGet(cookieHeader, '/authenticators/all/', client).catch(() => null),
      userApiGet(
        cookieHeader,
        `/sources/user_connections/all/?page_size=100${
          user.pk != null ? `&user=${encodeURIComponent(user.pk)}` : ''
        }`,
        client
      ).catch(() => null)
    ])

    // /authenticators/all/ is a plain array; a webauthn entry means a passkey or
    // security key that's been confirmed.
    const devices = Array.isArray(devicesBody) ? devicesBody : (devicesBody?.results ?? [])
    const hasPasskey = devices.some((device) => {
      return String(device.type ?? '').toLowerCase().includes('webauthn') && device.confirmed !== false
    })

    // Guard by pk client-side in case a superuser caller sees others' rows.
    const connections = (connsBody?.results ?? []).filter((conn) => {
      return conn.user == null || user.pk == null || String(conn.user) === String(user.pk)
    })
    const hasSocial = connections.length > 0

    return { hasPasskey, hasSocial }
  }

  // Report the caller's current passwordless-eligibility. The SPA also derives
  // this itself for the UI; this endpoint is the authoritative check the POST
  // relies on, exposed so the page can stay in sync if it wants.
  app.get('/', async (request, reply) => {
    const user = await requireCaller(request, reply)
    if (!user) {
      return
    }
    try {
      const { hasPasskey, hasSocial } = await passwordlessMethods(
        request.headers.cookie,
        user,
        clientFromRequest(request)
      )
      return { hasPasskey, hasSocial, canRemove: hasPasskey || hasSocial }
    } catch (err) {
      if (err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
  })

  // Remove the password. Refuses unless the caller still has a passkey or social
  // login, so this can never be the step that locks someone out.
  app.post('/', async (request, reply) => {
    const user = await requireCaller(request, reply)
    if (!user) {
      return
    }
    const client = clientFromRequest(request)
    try {
      const { hasPasskey, hasSocial } = await passwordlessMethods(
        request.headers.cookie,
        user,
        client
      )
      if (!hasPasskey && !hasSocial) {
        return reply.badRequest(
          'Add a passkey or connect a social login before removing your password.'
        )
      }
      // Blank the known password (see the file header for why it's a random value
      // rather than a true unusable password).
      await setUserPassword(user.pk, randomBytes(48).toString('base64url'), client)
      request.log.info({ pk: user.pk, username: user.username }, 'passwordless: password removed')
      return { removed: true }
    } catch (err) {
      if (err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
  })
}
