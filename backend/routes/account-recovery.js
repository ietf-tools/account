import {
  findUserByEmail,
  findUserByUsername,
  getUser,
  patchUser,
  setUserPassword,
  clientFromRequest,
  AuthentikError
} from '../lib/authentik.js'
import {
  RECOVERY_EMAILS_KEY,
  storedRecoveryEmails,
  listRecoveryEmails,
  normalizeRecoveryEmail,
  hasRecoveryEmail
} from '../lib/recovery-emails.js'
import {
  signVerificationToken,
  verifyVerificationToken,
  PURPOSE_ACCOUNT_RECOVERY
} from '../lib/token.js'
import { sendAccountRecoveryVerification } from '../lib/mailer.js'
import { gravatarUrl, isGravatarUrl } from '../lib/gravatar.js'
import { config } from '../lib/config.js'

/**
 * Account recovery — getting back in when you can neither sign in NOR read mail at
 * the account's primary address. Unauthenticated by definition, so nothing here
 * trusts a session; the signed link is the only authorisation.
 *
 * Three steps:
 *   1. POST /          — "my account is <account>, mail me at <recovery>". If that
 *      address is a confirmed recovery address on that account, we stash it on
 *      `attributes.pending_account_recovery` and mail a signed link to it.
 *      **The reply is identical either way** (see below).
 *   2. POST /options   — the link opens verify-account-recovery.vue, which reads
 *      back the account's recovery addresses so the user can pick one. Read-only.
 *   3. POST /complete  — the explicit submit: adopt the chosen recovery address as
 *      the primary email + username, set a new password, drop the old address.
 *
 * ── Why step 1 never says whether it matched ──────────────────────────────────
 * Anyone can POST any pair of addresses. A truthful "no such recovery address"
 * would turn this endpoint into an oracle for "does account X exist" and "is Y a
 * recovery address of X" — the second being a link between two of someone's
 * addresses that is not otherwise public. So the response is a flat `{ sent: true }`
 * whether we matched, found no account, or failed to send. A mail that never
 * arrives is the intended (and only) signal that something didn't match.
 *
 * ── Pre-fetch safety ──────────────────────────────────────────────────────────
 * Same guard as the other mailed links: the link only renders a page. Steps 2 and 3
 * are POSTs the SPA makes, so a mail scanner following the URL changes nothing —
 * and step 2 is a read even then.
 */
export default async function accountRecoveryRoutes(app) {
  const PENDING_KEY = 'pending_account_recovery'
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  // Shorter than the email-change / add-recovery-address links (1 hour): this one
  // grants a full takeover, so it should be usable for as little time as is still
  // practical for someone reading mail at a secondary address.
  const TTL_SECONDS = 30 * 60
  const TTL_TEXT = '30 minutes'
  // authentik's password policies run inside its flows, and this path sets the
  // password through the admin API instead — so they do NOT apply here. This is the
  // only floor there is. See the note in README/CLAUDE if you tighten it.
  const MIN_PASSWORD_LENGTH = 8

  // The account someone names at step 1. Username and email are kept identical by
  // this app (see routes/email-change.js), but the sign-in form accepts either, so
  // accept either here rather than failing someone who typed what they always type.
  async function findAccount(identifier) {
    if (!identifier) {
      return null
    }
    return (await findUserByEmail(identifier)) ?? (await findUserByUsername(identifier))
  }

  // Resolve a token to the account it authorises, or null. The pending marker must
  // still name the same address, which is what makes a link single-use: step 3
  // clears it, and a second recovery request replaces it.
  async function accountForToken(token, client) {
    let claims = null
    try {
      claims = verifyVerificationToken(token, PURPOSE_ACCOUNT_RECOVERY)
    } catch {
      return null
    }
    const user = await getUser(claims.pk, client)
    if (!user) {
      return null
    }
    if (String(user.attributes?.[PENDING_KEY] ?? '').toLowerCase() !== claims.email.toLowerCase()) {
      return null
    }
    return { user, claims }
  }

  // Step 1: request a recovery link. Always answers the same.
  app.post('/', async (request, reply) => {
    const account = String(request.body?.account ?? '').trim()
    const recovery = String(request.body?.recovery ?? '').trim().toLowerCase()

    // The only thing worth rejecting outright is input that can't be an address at
    // all — that's a client-side mistake, not information about any account.
    if (!account || !EMAIL_RE.test(recovery)) {
      return reply.badRequest('Please enter your account email address and a recovery address.')
    }

    const client = clientFromRequest(request)
    try {
      const user = await findAccount(account)
      if (!user) {
        request.log.info('account-recovery: no such account (reported as sent)')
        return { sent: true }
      }

      const full = await getUser(user.pk, client)
      if (!hasRecoveryEmail(storedRecoveryEmails(full), recovery)) {
        request.log.info({ pk: user.pk }, 'account-recovery: address not on file (reported as sent)')
        return { sent: true }
      }

      // attributes is replaced wholesale on PATCH — read and merge (see patchUser).
      const attributes = { ...full.attributes, [PENDING_KEY]: recovery }
      await patchUser(user.pk, { attributes }, client)

      const token = signVerificationToken({
        purpose: PURPOSE_ACCOUNT_RECOVERY,
        pk: user.pk,
        email: recovery,
        ttlSeconds: TTL_SECONDS
      })
      const url = `${config.publicAppUrl}/verify-account-recovery?token=${encodeURIComponent(token)}`
      await sendAccountRecoveryVerification({
        to: recovery,
        name: full.name || full.username,
        account: full.email || full.username,
        url,
        expiresText: TTL_TEXT
      })

      request.log.info({ pk: user.pk }, 'account-recovery: link sent')
      return { sent: true }
    } catch (err) {
      // Even a genuine failure answers the same way: a 502 here would only be
      // returned for accounts that got far enough to matter, which is the leak this
      // endpoint exists to avoid. Log it loudly instead — nobody else will see it.
      request.log.error(
        { err: err instanceof AuthentikError ? err.message : String(err?.message ?? err) },
        'account-recovery: request failed (reported as sent)'
      )
      return { sent: true }
    }
  })

  // Step 2: what the confirmation page needs to render — the addresses on the
  // account that can become the new primary. Read-only.
  //
  // Note this discloses the account's other recovery addresses to whoever holds the
  // link. That is inherent in "choose which one to keep", and the holder has already
  // proved control of one of them.
  app.post('/options', async (request, reply) => {
    const client = clientFromRequest(request)
    try {
      const found = await accountForToken(request.body?.token, client)
      if (!found) {
        return reply.badRequest('This recovery link is invalid, already used, or has expired.')
      }
      return {
        // The address the link was sent to, so the page can preselect it.
        sentTo: found.claims.email,
        account: found.user.email || found.user.username,
        emails: listRecoveryEmails(found.user),
        minPasswordLength: MIN_PASSWORD_LENGTH
      }
    } catch (err) {
      if (err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
  })

  // Step 3: apply it. The chosen recovery address becomes the primary email and
  // username, the password is replaced, and the old primary address is dropped —
  // it is deliberately NOT kept as a recovery address, since being unable to read
  // mail there is the reason someone is here.
  app.post('/complete', async (request, reply) => {
    const chosen = String(request.body?.email ?? '').trim().toLowerCase()
    const password = String(request.body?.password ?? '')
    const client = clientFromRequest(request)

    try {
      const found = await accountForToken(request.body?.token, client)
      if (!found) {
        return reply.badRequest('This recovery link is invalid, already used, or has expired.')
      }
      const { user } = found

      const stored = storedRecoveryEmails(user)
      if (!hasRecoveryEmail(stored, chosen)) {
        return reply.badRequest('Choose one of the recovery email addresses on this account.')
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        return reply.badRequest(
          `Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.`
        )
      }
      // The address has to be free to become a primary: another account may have
      // taken it since it was added here.
      const clash = await findUserByEmail(chosen)
      if (clash && String(clash.pk) !== String(user.pk)) {
        return reply.conflict('That email address is now in use by another account.')
      }

      const attributes = { ...user.attributes }
      // The chosen address is being promoted, so it stops being a recovery address;
      // the rest stay, in their stored shape.
      attributes[RECOVERY_EMAILS_KEY] = stored.filter((entry) => {
        return normalizeRecoveryEmail(entry)?.email.toLowerCase() !== chosen
      })
      // Recovery invalidates every in-flight address change: those links were mailed
      // before the account was recovered, and honouring one afterwards would let a
      // pre-recovery request move the address again.
      delete attributes[PENDING_KEY]
      delete attributes.pending_email
      delete attributes.pending_recovery_email
      // A gravatar avatar hashes the address, so it has to follow it — same rule as
      // routes/email-change.js. Uploads and generated initials are unaffected.
      if (isGravatarUrl(attributes.avatar)) {
        attributes.avatar = gravatarUrl(chosen)
      }

      // Address first, password second. Either order can half-apply if the second
      // call fails, and this is the recoverable half: the account is then reachable
      // at an address the user controls, so the ordinary password reset finishes the
      // job. The reverse would leave them knowing a password for an account whose
      // mail they still can't read.
      await patchUser(user.pk, { email: chosen, username: chosen, attributes }, client)
      await setUserPassword(user.pk, password, client)

      request.log.info({ pk: user.pk }, 'account-recovery: completed')
      return { recovered: true, email: chosen }
    } catch (err) {
      if (err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
  })
}
