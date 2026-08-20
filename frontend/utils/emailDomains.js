// Client-side twin of backend/lib/email-domains.ts: which email domains may not be
// attached to an account, and how an address is matched against them. The two must
// stay in sync — the list itself already is (both sides read BLOCKED_EMAIL_DOMAINS,
// the browser's copy arriving through nuxt.config.ts as runtime config), so it's the
// matching rule below that has to be kept identical by hand.
//
// Nothing here is a gate. It exists so a blocked address is refused in the form the
// user is looking at, instead of after a round-trip. The real refusals live where the
// address is actually written:
//   * registration -> an authentik policy on both enrollment flows, since the SPA
//     drives those straight against authentik and never touches our backend
//     (authentik/ietf-flows/ietf-blocked-email-domains.yaml);
//   * recovery addresses and the primary-address change -> the backend routes.
//
// Matching: a domain matches that hostname EXACTLY, so "ietf.org" blocks x@ietf.org
// but leaves x@staff.ietf.org alone — a subdomain is its own mail domain and is
// blocked only by being listed itself. Only the part after the LAST "@" is read (a
// quoted local part may legally contain one).

// The blocked domain `email` falls under, or null if it's allowed. Returns the domain
// so the caller can name it — "addresses at ietf.org" is actionable, "that address"
// isn't. An unparseable address is not blocked; callers check the shape separately.
export function blockedEmailDomain(email, domains) {
  const address = String(email ?? '').trim().toLowerCase()
  const at = address.lastIndexOf('@')
  if (at < 0) {
    return null
  }
  const host = address.slice(at + 1).replace(/\.+$/, '')
  if (!host) {
    return null
  }
  return (domains ?? []).find((domain) => domain === host) ?? null
}

// One wording for every surface that asks the user for an address, so the reason
// reads the same on the sign-up form, the recovery-address form and the profile page
// — and matches what the backend routes answer with, since a user can meet either
// (the inline check only runs where the list reached the browser at build time).
// `use` names what the address was being offered for.
export function blockedEmailDomainMessage(domain, use = 'for an IETF account') {
  return (
    `Addresses at ${domain} cannot be used ${use}. ` +
    'Please use a personal address you will keep long-term.'
  )
}
