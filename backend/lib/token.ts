import { createHmac, timingSafeEqual } from 'node:crypto'

import { config } from './config.ts'

/**
 * Stateless, signed capability tokens for the backend's email-verification flows
 * (changing your primary address; adding a recovery address).
 *
 * A token carries its purpose, the target user pk, the email being proved, and an
 * expiry, signed with an HMAC keyed by SESSION_SECRET. It is what a confirmation
 * link embeds: possession of a valid, unexpired token authorises the action. We
 * keep it stateless (no server-side store) so it survives a backend restart and
 * works across instances — single-use is enforced separately by each route, which
 * only acts while the matching `attributes.pending_*` marker still matches.
 *
 * **The purpose is part of the signed payload and is checked on verify**, so a link
 * mailed for one flow cannot be replayed against the other's endpoint: both carry
 * {pk, email} and would otherwise be interchangeable.
 *
 * Format: base64url(payloadJSON) + "." + base64url(hmac). Both the value and the
 * signature are compared in constant time on verify.
 */

const SECRET = config.session.secret

export const PURPOSE_EMAIL_CHANGE = 'email-change'
export const PURPOSE_RECOVERY_EMAIL = 'recovery-email'
// Strictly more powerful than the other two: holding a valid one of these lets the
// bearer take the account over (new primary address + new password). Minted only
// for an address already confirmed on the account, and given a shorter life — see
// routes/account-recovery.ts.
export const PURPOSE_ACCOUNT_RECOVERY = 'account-recovery'

/**
 * Which flow a token was minted for. Signed into the payload and checked on
 * verify, so a link mailed for one flow cannot be replayed against another's
 * endpoint — see the header.
 */
export type TokenPurpose =
  | typeof PURPOSE_EMAIL_CHANGE
  | typeof PURPOSE_RECOVERY_EMAIL
  | typeof PURPOSE_ACCOUNT_RECOVERY

/** The signed payload, as it is written and read back. */
interface TokenPayload {
  purpose: TokenPurpose
  pk: string
  email: string
  exp: number
}

/** What a verified token proves: which account, and which address. */
export interface TokenClaims {
  pk: string
  email: string
}

function b64url(buf: string): string {
  return Buffer.from(buf).toString('base64url')
}

function sign(payloadB64: string): string {
  return createHmac('sha256', SECRET).update(payloadB64).digest('base64url')
}

// Mint a token for {purpose, pk, email}, valid for ttlSeconds from now.
export function signVerificationToken({
  purpose,
  pk,
  email,
  ttlSeconds
}: {
  purpose: TokenPurpose
  pk: string | number
  email: string
  ttlSeconds: number
}): string {
  const payload: TokenPayload = {
    purpose,
    pk: String(pk),
    email,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds
  }
  const payloadB64 = b64url(JSON.stringify(payload))
  return `${payloadB64}.${sign(payloadB64)}`
}

// Verify a token minted for `purpose` and return its claims { pk, email }. Throws
// on any malformed, tampered, expired, or wrong-purpose token — callers should
// treat a throw as "invalid link".
export function verifyVerificationToken(token: unknown, purpose: TokenPurpose): TokenClaims {
  const parts = String(token).split('.')
  if (parts.length !== 2) {
    throw new Error('malformed token')
  }
  const [payloadB64, sig] = parts
  const expected = sign(payloadB64)
  // Constant-time compare; timingSafeEqual throws on length mismatch, so guard.
  const sigBuf = Buffer.from(sig)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('bad signature')
  }
  let payload: Partial<TokenPayload>
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    throw new Error('bad payload')
  }
  if (!payload?.pk || !payload?.email || !payload?.exp) {
    throw new Error('incomplete payload')
  }
  // Signed, so this can't be swapped by the holder — it separates the flows.
  if (payload.purpose !== purpose) {
    throw new Error('wrong purpose')
  }
  if (Math.floor(Date.now() / 1000) > payload.exp) {
    throw new Error('expired')
  }
  return { pk: String(payload.pk), email: String(payload.email) }
}
