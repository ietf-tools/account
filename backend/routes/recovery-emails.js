import {
  resolveSessionUser,
  findUserByEmail,
  getUser,
  patchUser,
  clientFromRequest,
  AuthentikError
} from '../lib/authentik.js'
import {
  signVerificationToken,
  verifyVerificationToken,
  PURPOSE_RECOVERY_EMAIL
} from '../lib/token.js'
import { sendRecoveryEmailVerification } from '../lib/mailer.js'
import {
  RECOVERY_EMAILS_KEY,
  normalizeRecoveryEmail as normalize,
  storedRecoveryEmails,
  hasRecoveryEmail as hasAddress
} from '../lib/recovery-emails.js'
import { config } from '../lib/config.js'

/**
 * The caller's recovery email addresses (`attributes.recovery_emails`, seeded to
 * `[]` on enrollment — see authentik/ietf-flows/ietf-enrollment-account-defaults.yaml):
 * list them, add one (verified), and remove one.
 *
 * Exists for the same reason as routes/datatracker.js: the browser cannot see user
 * attributes at all (authentik's self serializer at /core/users/me/ omits
 * `attributes`), let alone write them — both need the admin token. The caller is
 * resolved from their own authentik session cookie, never from anything the browser
 * sends, so these can only ever read or change the caller's own list.
 *
 * ── Adding is verified, in two steps ───────────────────────────────────────────
 * Modelled on routes/email-change.js, and both steps are pre-fetch-safe (a bare GET
 * never mutates — the confirm is an explicit POST the SPA makes, and the SPA needs
 * JS to make it):
 *   1. POST /        — the signed-in user proposes an address. We stash it on
 *      `attributes.pending_recovery_email` and email a signed, time-limited
 *      confirmation link to THAT address.
 *   2. POST /verify  — the link opens verify-recovery-email.vue, which posts the
 *      token back on an explicit click. We validate it, confirm the pending address
 *      still matches (single-use), then append it to the list.
 *
 * The address is only ever added by step 2, so an address nobody can read mail at
 * can never end up on the list — which matters, because this list is what gets
 * someone back into an account.
 */
export default async function recoveryEmailsRoutes(app) {
  const ATTRIBUTE_KEY = RECOVERY_EMAILS_KEY
  const PENDING_KEY = 'pending_recovery_email'
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const TTL_SECONDS = 60 * 60 // 1 hour
  const TTL_TEXT = '1 hour'
  // `attributes` is a JSON blob on the user and each add sends mail to an arbitrary
  // address, so the list is capped. Reported by GET so the UI states the limit
  // rather than only discovering it as an error.
  const MAX_ADDRESSES = 5

  // How an entry is read, and how addresses are compared, is shared with the
  // account-recovery flow — see lib/recovery-emails.js for why.
  const storedList = storedRecoveryEmails

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
      reply.unauthorized('You must be signed in to manage your recovery emails')
      return null
    }
    return user
  }

  app.get('/', async (request, reply) => {
    const user = await requireCaller(request, reply)
    if (!user) {
      return
    }
    try {
      const full = await getUser(user.pk, clientFromRequest(request))
      return {
        emails: storedList(full).map(normalize).filter(Boolean),
        max: MAX_ADDRESSES,
        // Surfaced so the page can say an address is awaiting confirmation instead
        // of looking like the request vanished.
        pending: full.attributes?.[PENDING_KEY] ?? null
      }
    } catch (err) {
      if (err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
  })

  // Step 1: propose an address — stash it as pending and email a link to it.
  // Nothing is added to the list here.
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
      return reply.badRequest('That is already your primary email address.')
    }

    try {
      // Recovery addresses are how an account is identified when its owner has lost
      // the primary address, so two accounts must not answer to the same one. Same
      // conflict rule as routes/email-change.js, for the same reason.
      const existing = await findUserByEmail(email)
      if (existing && String(existing.pk) !== String(user.pk)) {
        return reply.conflict('That email address is already in use by another account.')
      }

      const full = await getUser(user.pk, client)
      const stored = storedList(full)
      if (hasAddress(stored, email)) {
        return reply.conflict('That address is already one of your recovery emails.')
      }
      if (stored.length >= MAX_ADDRESSES) {
        return reply.badRequest(
          `You can have up to ${MAX_ADDRESSES} recovery email addresses. Remove one first.`
        )
      }

      // Stash the proposed address (attributes is replaced wholesale on PATCH, so
      // read the full object and merge — see patchUser's note). One pending address
      // at a time: proposing another supersedes the first, which is also what makes
      // the confirmation single-use.
      const attributes = { ...full.attributes, [PENDING_KEY]: email }
      await patchUser(user.pk, { attributes }, client)

      const token = signVerificationToken({
        purpose: PURPOSE_RECOVERY_EMAIL,
        pk: user.pk,
        email,
        ttlSeconds: TTL_SECONDS
      })
      const url = `${config.publicAppUrl}/verify-recovery-email?token=${encodeURIComponent(token)}`
      await sendRecoveryEmailVerification({
        to: email,
        name: full.name || user.name || user.username,
        account: user.email || user.username,
        url,
        expiresText: TTL_TEXT
      })

      request.log.info({ pk: user.pk }, 'recovery-emails: verification sent')
      return { sent: true, email }
    } catch (err) {
      if (err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      // Mailer / SMTP failures land here — surface a clean 502 rather than a 500.
      request.log.error({ err: err.message }, 'recovery-emails: could not send verification')
      return reply
        .code(502)
        .send({ error: 'Could not send the verification email. Please try again.' })
    }
  })

  // Step 2: confirm — add the address if the token is valid and still pending.
  // No session needed: the token authorises it, so the link works on any device
  // (the whole point is that it was opened at the address being proved).
  app.post('/verify', async (request, reply) => {
    let claims = null
    try {
      claims = verifyVerificationToken(request.body?.token, PURPOSE_RECOVERY_EMAIL)
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
      // Once applied (or superseded by a newer request), it won't — so replaying an
      // old link can't re-add an address that has since been removed.
      if (String(full.attributes?.[PENDING_KEY] ?? '').toLowerCase() !== claims.email.toLowerCase()) {
        return reply.badRequest('This confirmation link has already been used or is no longer valid.')
      }
      // Everything the request step refused has to be refused here too: an hour can
      // pass before the link is opened, and the account can have moved underneath
      // it. These are re-read, never taken from the token.
      //
      // Re-check the address didn't get claimed by another account meanwhile.
      const existing = await findUserByEmail(claims.email)
      if (existing && String(existing.pk) !== String(claims.pk)) {
        return reply.conflict('That email address is now in use by another account.')
      }
      // …or become this account's own primary address (the email-change flow can
      // move it there), which would make it a recovery address for itself.
      if (String(full.email ?? '').toLowerCase() === claims.email.toLowerCase()) {
        return reply.badRequest(
          'That is now your primary email address, so it cannot also be a recovery address.'
        )
      }

      const stored = storedList(full)
      const duplicate = hasAddress(stored, claims.email)
      // …or overflow the cap, if addresses were added by another route meanwhile.
      // The pending marker is deliberately left in place: free a slot and this same
      // link still works (while it lasts), rather than forcing a fresh request.
      if (!duplicate && stored.length >= MAX_ADDRESSES) {
        return reply.badRequest(
          `You already have ${MAX_ADDRESSES} recovery email addresses. ` +
            'Remove one and open this link again.'
        )
      }

      const attributes = { ...full.attributes }
      delete attributes[PENDING_KEY]
      // Tolerate a concurrent add of the same address: clearing the pending marker
      // is still the right outcome, and the result the caller sees is correct.
      attributes[ATTRIBUTE_KEY] = duplicate ? stored : [...stored, claims.email]
      await patchUser(claims.pk, { attributes }, client)

      request.log.info({ pk: claims.pk }, 'recovery-emails: address added')
      return { added: true, email: claims.email }
    } catch (err) {
      if (err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
  })

  // Drop one address from the list. The address is matched case-insensitively
  // (addresses are compared, not identified by index — the browser's copy of the
  // list can be stale, and removing "the third one" would then remove the wrong one).
  app.delete('/:email', async (request, reply) => {
    const user = await requireCaller(request, reply)
    if (!user) {
      return
    }
    const target = String(request.params.email ?? '').trim().toLowerCase()
    if (!target) {
      return reply.badRequest('No address given.')
    }

    const client = clientFromRequest(request)
    try {
      const full = await getUser(user.pk, client)
      const stored = storedList(full)
      // Filter the *stored* entries, not the normalized ones, so the shape of every
      // address we keep survives untouched. Entries we can't read are kept too —
      // this endpoint removes one address, it isn't a cleanup pass.
      const kept = stored.filter((entry) => {
        const parsed = normalize(entry)
        return !parsed || parsed.email.toLowerCase() !== target
      })
      if (kept.length === stored.length) {
        return reply.notFound('That address is not on your recovery list.')
      }

      // authentik REPLACES `attributes` wholesale on PATCH (it's a JSON field, not
      // deep-merged), so send the full object back with only this key changed —
      // see patchUser's note.
      const attributes = { ...full.attributes, [ATTRIBUTE_KEY]: kept }
      await patchUser(user.pk, { attributes }, client)

      request.log.info({ pk: user.pk, remaining: kept.length }, 'recovery-emails: address removed')
      return { emails: kept.map(normalize).filter(Boolean) }
    } catch (err) {
      if (err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
  })
}
