/**
 * Which email domains may not be attached to an account, and how an address is
 * matched against them. Shared by every backend route that accepts an address the
 * user picked: routes/recovery-emails.js and routes/email-change.js.
 *
 * It lives here rather than in either route for the same reason lib/recovery-emails.js
 * does: the two must agree exactly on what counts as blocked. If they drifted, an
 * address refused as a recovery address could still be moved in as the primary one,
 * which is the same account either way.
 *
 * The list comes from BLOCKED_EMAIL_DOMAINS (config.blockedEmailDomains) — add
 * domains there, not here. Two other copies of the list exist and are NOT imported
 * from this file, because they run somewhere this module can't:
 *   * frontend/utils/emailDomains.js — the SPA's inline check, fed by the same env
 *     var through nuxt.config.ts;
 *   * authentik/ietf-flows/ietf-blocked-email-domains.yaml — the registration gate,
 *     which runs inside authentik as a policy expression.
 *
 * ── Matching ──────────────────────────────────────────────────────────────────
 * A domain matches that hostname EXACTLY and nothing else: "ietf.org" blocks
 * `x@ietf.org` but leaves `x@staff.ietf.org` alone. Subdomains are their own mail
 * domains with their own answer here — several under ietf.org are real, personal
 * mailboxes — so blocking one is an explicit choice: add it to the list. Comparison
 * is lower-cased, and only the part after the LAST "@" is considered (a local part
 * may legally contain one when quoted, and taking the first would read the wrong
 * host).
 */

import { config } from './config.js'

/**
 * The blocked domain `email` falls under, or null if it's allowed. Returns the
 * matched domain rather than a boolean so callers can name it in the message —
 * "addresses at ietf.org" is actionable in a way "that address" is not.
 *
 * An unparseable address is not blocked: it isn't this function's job to reject
 * one, and every caller validates the shape separately.
 */
export function blockedEmailDomain(email, domains = config.blockedEmailDomains) {
  const address = String(email ?? '').trim().toLowerCase()
  const at = address.lastIndexOf('@')
  if (at < 0) {
    return null
  }
  const host = address.slice(at + 1).replace(/\.+$/, '')
  if (!host) {
    return null
  }
  return domains.find((domain) => domain === host) ?? null
}
