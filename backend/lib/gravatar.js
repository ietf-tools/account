import { createHash } from 'node:crypto'

/**
 * Build a Gravatar URL for an email, matching how authentik derives one (MD5 of
 * the trimmed, lower-cased address). We compute it here so the avatar tab can
 * preview the exact image authentik will serve (and expose to other apps via the
 * `picture` claim) once the user switches to Gravatar mode — the browser can't
 * do MD5 with the Web Crypto API.
 *
 * `d=mp` renders the neutral "mystery person" silhouette when the address has no
 * Gravatar, rather than a broken image.
 */
export function gravatarUrl(email, size = 256) {
  const normalised = String(email ?? '').trim().toLowerCase()
  const hash = createHash('md5').update(normalised).digest('hex')
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=mp`
}

// Is this stored avatar URL one we built above? Gravatar mode now records a real
// URL on the user (rather than clearing the attribute), so this is how the avatar
// route recognises that mode on read — and how the email-change route knows to
// re-derive the URL, since it is a hash of the address.
export function isGravatarUrl(url) {
  return typeof url === 'string' && /^https:\/\/(www\.)?gravatar\.com\//.test(url)
}
