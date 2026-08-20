/**
 * How `attributes.recovery_emails` is read, shared by everything that touches it:
 * the signed-in management routes (routes/recovery-emails.ts) and the unauthenticated
 * account-recovery flow (routes/account-recovery.ts).
 *
 * It lives here rather than in either route because the two must agree exactly on
 * what counts as a recovery address. If they drifted, an address could be listed as
 * usable in one place and be invisible to the other — and the flow that reads this
 * list is the one that lets someone back into an account.
 */

import { isPlainObject } from './attributes.ts'
import type { AuthentikUser } from './authentik.ts'

export const RECOVERY_EMAILS_KEY = 'recovery_emails'

/** A readable entry, reduced to the one field that matters. */
export interface RecoveryEmail {
  email: string
}

/**
 * Entries are written as plain address strings. Hand-edited accounts may hold
 * objects ({ email | address, … }), so accept those too rather than dropping them
 * silently. Returns { email } — or null for anything unreadable.
 */
export function normalizeRecoveryEmail(entry: unknown): RecoveryEmail | null {
  if (typeof entry === 'string') {
    return { email: entry.trim() }
  }
  if (isPlainObject(entry)) {
    const email = entry.email ?? entry.address
    if (typeof email === 'string' && email.trim()) {
      return { email: email.trim() }
    }
  }
  return null
}

// The raw stored entries, in their on-disk shape (so callers can filter without
// rewriting the ones they keep).
export function storedRecoveryEmails(user: AuthentikUser | null | undefined): unknown[] {
  const stored = user?.attributes?.[RECOVERY_EMAILS_KEY]
  return Array.isArray(stored) ? stored : []
}

// Readable entries only, as { email }. Entries we can't read are dropped rather
// than surfaced as holes — every caller is answering "which addresses are on this
// account", and an unreadable entry is not an answer to that.
export function readableRecoveryEmails(stored: unknown[]): RecoveryEmail[] {
  return stored
    .map(normalizeRecoveryEmail)
    .filter((entry): entry is RecoveryEmail => entry !== null)
}

// The readable entries of a user's stored list, as { email }.
export function listRecoveryEmails(user: AuthentikUser | null | undefined): RecoveryEmail[] {
  return readableRecoveryEmails(storedRecoveryEmails(user))
}

// Addresses are compared case-insensitively everywhere they're compared.
export function hasRecoveryEmail(stored: unknown[], email: unknown): boolean {
  const target = String(email ?? '').trim().toLowerCase()
  if (!target) {
    return false
  }
  return stored.some((entry) => normalizeRecoveryEmail(entry)?.email.toLowerCase() === target)
}
