/**
 * How `attributes.recovery_emails` is read, shared by everything that touches it:
 * the signed-in management routes (routes/recovery-emails.js) and the unauthenticated
 * account-recovery flow (routes/account-recovery.js).
 *
 * It lives here rather than in either route because the two must agree exactly on
 * what counts as a recovery address. If they drifted, an address could be listed as
 * usable in one place and be invisible to the other — and the flow that reads this
 * list is the one that lets someone back into an account.
 */

export const RECOVERY_EMAILS_KEY = 'recovery_emails'

/**
 * Entries are written as plain address strings. Hand-edited accounts may hold
 * objects ({ email | address, … }), so accept those too rather than dropping them
 * silently. Returns { email } — or null for anything unreadable.
 */
export function normalizeRecoveryEmail(entry) {
  if (typeof entry === 'string') {
    return { email: entry.trim() }
  }
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const email = entry.email ?? entry.address
    if (typeof email === 'string' && email.trim()) {
      return { email: email.trim() }
    }
  }
  return null
}

// The raw stored entries, in their on-disk shape (so callers can filter without
// rewriting the ones they keep).
export function storedRecoveryEmails(user) {
  const stored = user?.attributes?.[RECOVERY_EMAILS_KEY]
  return Array.isArray(stored) ? stored : []
}

// Readable entries only, as { email }.
export function listRecoveryEmails(user) {
  return storedRecoveryEmails(user).map(normalizeRecoveryEmail).filter(Boolean)
}

// Addresses are compared case-insensitively everywhere they're compared.
export function hasRecoveryEmail(stored, email) {
  const target = String(email ?? '').trim().toLowerCase()
  if (!target) {
    return false
  }
  return stored.some((entry) => normalizeRecoveryEmail(entry)?.email.toLowerCase() === target)
}
