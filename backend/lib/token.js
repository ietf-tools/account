import { createHmac, timingSafeEqual } from 'node:crypto'

import { config } from './config.js'

/**
 * Stateless, signed capability tokens for the verified email-change flow.
 *
 * A token carries the target user pk, the new email, and an expiry, signed with
 * an HMAC keyed by SESSION_SECRET. It is what the confirmation link embeds:
 * possession of a valid, unexpired token authorises applying the change. We keep
 * it stateless (no server-side store) so it survives a backend restart and works
 * across instances — single-use is enforced separately by the route, which only
 * applies the change while the user's `attributes.pending_email` still matches.
 *
 * Format: base64url(payloadJSON) + "." + base64url(hmac). Both the value and the
 * signature are compared in constant time on verify.
 */

const SECRET = config.session.secret

function b64url(buf) {
  return Buffer.from(buf).toString('base64url')
}

function sign(payloadB64) {
  return createHmac('sha256', SECRET).update(payloadB64).digest('base64url')
}

// Mint a token for {pk, email}, valid for ttlSeconds from now.
export function signEmailChangeToken({ pk, email, ttlSeconds }) {
  const payload = { pk: String(pk), email, exp: Math.floor(Date.now() / 1000) + ttlSeconds }
  const payloadB64 = b64url(JSON.stringify(payload))
  return `${payloadB64}.${sign(payloadB64)}`
}

// Verify a token and return its claims { pk, email }. Throws on any malformed,
// tampered, or expired token — callers should treat a throw as "invalid link".
export function verifyEmailChangeToken(token) {
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
  let payload
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    throw new Error('bad payload')
  }
  if (!payload?.pk || !payload?.email || !payload?.exp) {
    throw new Error('incomplete payload')
  }
  if (Math.floor(Date.now() / 1000) > payload.exp) {
    throw new Error('expired')
  }
  return { pk: String(payload.pk), email: String(payload.email) }
}
