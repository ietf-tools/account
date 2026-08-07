import {
  resolveSessionUser,
  findUserByEmail,
  getUser,
  patchUser,
  clientFromRequest,
  AuthentikError
} from '../lib/authentik.js'
import { gravatarUrl, isGravatarUrl } from '../lib/gravatar.js'
import {
  signVerificationToken,
  verifyVerificationToken,
  PURPOSE_EMAIL_CHANGE
} from '../lib/token.js'
import { sendEmailChangeVerification } from '../lib/mailer.js'
import { config } from '../lib/config.js'

/**
 * Verified email change — a backend-only feature (like migration / passwordless):
 * it needs the admin API token to change a user's email + username, which can't
 * run browser-direct. Doing it here also sidesteps authentik's Email-stage
 * limitations for self-service flows (no pending user, no send-to-new-address).
 *
 * Two steps, both pre-fetch-safe (a bare GET never mutates — the confirm is an
 * explicit POST the SPA makes, and the SPA needs JS to make it):
 *   1. POST /            — the signed-in user requests a change. We stash the new
 *      address on the user's `attributes.pending_email` and email a signed,
 *      time-limited confirmation link to the NEW address.
 *   2. POST /verify      — the link opens verify-email-change.vue, which posts the
 *      token back here on an explicit click. We validate it, confirm the pending
 *      address still matches (single-use), then write email + username together
 *      (kept identical) and clear the pending marker.
 *
 * We never trust a pk from the browser: the initiating caller is resolved from
 * their authentik session cookie. The confirmation step is authorised by the
 * signed token instead (so the link works even on another device).
 */
export default async function emailChangeRoutes(app) {
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const TTL_SECONDS = 60 * 60 // 1 hour
  const TTL_TEXT = '1 hour'

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
      reply.unauthorized('You must be signed in to change your email address')
      return null
    }
    return user
  }

  // Step 1: request a change — stash the pending address and email a link to it.
  app.post('/', async (request, reply) => {
    const user = await requireCaller(request, reply)
    if (!user) {
      return
    }
    const client = clientFromRequest(request)
    const email = String(request.body?.email ?? '').trim().toLowerCase()

    if (!EMAIL_RE.test(email)) {
      return reply.badRequest('Please enter a valid email address.')
    }
    if (email === String(user.email ?? '').toLowerCase()) {
      return reply.badRequest('That is already your email address.')
    }

    try {
      const existing = await findUserByEmail(email)
      if (existing && String(existing.pk) !== String(user.pk)) {
        return reply.conflict('That email address is already in use.')
      }

      // Stash the desired address on the user (attributes is replaced wholesale on
      // PATCH, so read the full object and merge — see patchUser's note).
      const full = await getUser(user.pk, client)
      const attributes = { ...full.attributes, pending_email: email }
      await patchUser(user.pk, { attributes }, client)

      const token = signVerificationToken({
        purpose: PURPOSE_EMAIL_CHANGE,
        pk: user.pk,
        email,
        ttlSeconds: TTL_SECONDS
      })
      const url = `${config.publicAppUrl}/verify-email-change?token=${encodeURIComponent(token)}`
      await sendEmailChangeVerification({
        to: email,
        name: full.name || user.name || user.username,
        url,
        expiresText: TTL_TEXT
      })

      request.log.info({ pk: user.pk }, 'email-change: verification sent')
      return { sent: true, email }
    } catch (err) {
      if (err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      // Mailer / SMTP failures land here — surface a clean 502 rather than a 500.
      request.log.error({ err: err.message }, 'email-change: could not send verification')
      return reply.code(502).send({ error: 'Could not send the verification email. Please try again.' })
    }
  })

  // Step 2: confirm — apply the change if the token is valid and still pending.
  app.post('/verify', async (request, reply) => {
    let claims = null
    try {
      claims = verifyVerificationToken(request.body?.token, PURPOSE_EMAIL_CHANGE)
    } catch {
      return reply.badRequest('This confirmation link is invalid or has expired.')
    }
    const client = clientFromRequest(request)

    try {
      const full = await getUser(claims.pk, client)
      if (!full) {
        return reply.badRequest('This confirmation link is no longer valid.')
      }
      // Single-use / stale guard: the pending address must still match the token.
      // Once applied (or superseded by a newer request), it won't — so a replay
      // of an old link can't re-trigger or revert a change.
      if (String(full.attributes?.pending_email ?? '').toLowerCase() !== claims.email.toLowerCase()) {
        return reply.badRequest('This confirmation link has already been used or is no longer valid.')
      }
      // Re-check the address didn't get taken between request and confirm.
      const existing = await findUserByEmail(claims.email)
      if (existing && String(existing.pk) !== String(claims.pk)) {
        return reply.conflict('That email address is now in use by another account.')
      }

      const attributes = { ...full.attributes }
      delete attributes.pending_email
      // Gravatar mode stores a URL hashing the address (routes/avatar.js), so it has
      // to follow the address — otherwise the avatar keeps resolving against the old
      // one. Uploads and generated initials are address-independent; leave them be.
      if (isGravatarUrl(attributes.avatar)) {
        attributes.avatar = gravatarUrl(claims.email)
      }
      // Write email and username together, kept identical (safe: providers derive
      // the OAuth `sub` from the hashed user ID, unaffected by a username change).
      await patchUser(
        claims.pk,
        { email: claims.email, username: claims.email, attributes },
        client
      )

      request.log.info({ pk: claims.pk }, 'email-change: applied')
      return { changed: true, email: claims.email }
    } catch (err) {
      if (err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
  })
}
