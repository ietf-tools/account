import { createHash } from 'node:crypto'

import { resolveSessionUser, AuthentikError } from './authentik.js'

/**
 * Shared helpers for the image-upload routes (avatar + portrait). They differ in
 * how they process the image (square-crop vs aspect-preserving) and where they
 * store the URL, but parse/validate/identify the same way.
 */

// Input image types we accept from the browser. sharp can decode all of these;
// the routes always re-encode to WebP. GIF is deliberately excluded — we don't
// want animated images uploaded (and the routes flatten anything animated anyway).
export const ALLOWED_INPUT = new Set(['image/png', 'image/jpeg', 'image/webp'])

// Pull the mime type and raw bytes out of a `data:<mime>;base64,<data>` URI.
// Returns null if it isn't a base64 data URI.
export function parseDataUri(value) {
  const match = typeof value === 'string' && value.match(/^data:([^;,]+);base64,(.+)$/s)
  if (!match) {
    return null
  }
  return { mime: match[1].toLowerCase(), buffer: Buffer.from(match[2], 'base64') }
}

// Short content hash used in object keys so each distinct image gets a unique,
// immutably-cacheable URL.
export function shortHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 16)
}

// Resolve the acting user from their authentik session cookie, or reply 401.
// We never trust a pk from the browser — only the one authentik derives from its
// cookie. Returns the authentik user object on success, or null (reply sent).
export async function requireUser(request, reply) {
  let user = null
  try {
    user = await resolveSessionUser(request.headers.cookie)
  } catch (err) {
    if (err instanceof AuthentikError) {
      reply.code(err.status ?? 502).send({ error: err.message })
      return null
    }
    throw err
  }
  if (!user) {
    reply.unauthorized('You must be signed in to change your picture')
    return null
  }
  return user
}
