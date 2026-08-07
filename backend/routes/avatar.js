import sharp from 'sharp'

import { getUser, patchUser, clientFromRequest, AuthentikError } from '../lib/authentik.js'
import { gravatarUrl, isGravatarUrl } from '../lib/gravatar.js'
import { storageConfigured, putImage, deleteObject, keyFromUrl } from '../lib/storage.js'
import { ALLOWED_INPUT, parseDataUri, shortHash, requireUser } from '../lib/imageUpload.js'

/**
 * Avatar management — a custom, backend-only feature (like migration, it needs
 * the admin API token, so it can't run browser-direct the way the auth flows do).
 *
 * **attributes.avatar is always a URL**, in every mode — never empty, never image
 * bytes. Consumers (notably the OIDC `picture` claim other apps read) then get one
 * predictable, small, cacheable value whatever the user picked:
 *   • Gravatar — we compute the Gravatar URL for their address and store that.
 *   • Upload   — we normalise the image (EXIF-rotate, square-crop, resize,
 *     re-encode to WebP) and store it in object storage under a content-hashed key.
 *   • Initials — we generate a small SVG of the user's initials and store *that*
 *     in object storage too (content-hashed, `.svg`).
 *
 * Because the stored value no longer distinguishes itself by *absence*, the mode
 * is derived from the URL on read (`modeFor`): a gravatar.com URL is Gravatar, one
 * of our objects keyed `…-avatar-initials-…` is initials, anything else is an
 * upload. Values written by earlier versions still resolve correctly (an empty
 * attribute reads as Gravatar, an `data:image/svg+xml` URI as initials) and are
 * rewritten to a URL the next time the user saves.
 *
 * See routes/portrait.js for the companion full-size picture (aspect-preserving,
 * upload-only, stored in attributes.portrait).
 *
 * Deployment notes:
 *   • authentik's AVATARS setting must include `attributes.avatar` (e.g.
 *     `attributes.avatar,gravatar,initials`); the later entries only ever apply to
 *     users who have never visited this tab.
 *   • Add/adjust an OIDC property mapping to emit `{"picture": request.user.avatar}`
 *     so other apps receive the resolved URL.
 *   • Object storage is now required for *both* upload and initials mode.
 */

const AVATAR_SIZE = 256
const MAX_INPUT_BYTES = 10 * 1024 * 1024

// Raise the body limit for uploads: a base64 data URI of a multi-MB photo is well
// over Fastify's 1 MB default.
const ROUTE_BODY_LIMIT = 15 * 1024 * 1024

// Normalise an arbitrary image into square WebP bytes: honour EXIF orientation,
// cover-crop to a centred square, downscale, re-encode. Re-encoding also strips
// metadata and any non-image payload.
async function toAvatarWebp(buffer) {
  return sharp(buffer, { animated: false })
    .rotate()
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
    .webp({ quality: 82 })
    .toBuffer()
}

// Object-key variant marking a generated initials image, so we can tell one of our
// own objects apart from an uploaded picture just by looking at the stored URL.
const INITIALS_VARIANT = 'avatar-initials'

// How initials were stored before they moved into object storage. Still recognised
// on read so an account that hasn't re-saved since keeps showing the right mode.
const LEGACY_INITIALS_PREFIX = 'data:image/svg+xml'

// Which mode a stored attributes.avatar value represents. Nothing stored means the
// user predates this tab, in which case authentik's own fallback lands on Gravatar.
function modeFor(avatar) {
  if (!avatar) {
    return 'gravatar'
  }
  if (isGravatarUrl(avatar)) {
    return 'gravatar'
  }
  if (avatar.startsWith(LEGACY_INITIALS_PREFIX)) {
    return 'initials'
  }
  const key = keyFromUrl(avatar)
  if (key && key.includes(`-${INITIALS_VARIANT}-`)) {
    return 'initials'
  }
  return 'upload'
}

// Derive up to two initials from the user's display name (first letter of the
// first and last word), falling back to the username, then '?'.
function initialsFor(user) {
  const name = String(user?.name ?? '').trim()
  if (name) {
    const words = name.split(/\s+/)
    const first = words[0]?.[0] ?? ''
    const last = words.length > 1 ? words[words.length - 1][0] : ''
    const initials = `${first}${last}`.toUpperCase()
    if (initials) {
      return initials
    }
  }
  const username = String(user?.username ?? '').trim()
  if (username) {
    return username[0].toUpperCase()
  }
  return '?'
}

// Deterministic, pleasant background hue derived from the seed so a given user
// always gets the same colour.
function hueFor(seed) {
  let hash = 0
  for (const char of String(seed)) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360
  }
  return hash
}

// The initials are user-derived and land in a document we serve as its own file,
// so escape them rather than trusting they're two harmless letters.
function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Build an initials avatar as SVG bytes, ready to store as an object: square,
// centred glyphs on a solid deterministic background.
function initialsSvg(user) {
  const initials = initialsFor(user)
  const hue = hueFor(user?.email || user?.username || initials)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" ` +
    `viewBox="0 0 ${AVATAR_SIZE} ${AVATAR_SIZE}">` +
    `<rect width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" fill="hsl(${hue}, 60%, 45%)"/>` +
    `<text x="50%" y="50%" fill="#ffffff" font-size="110" font-weight="600" ` +
    `font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" ` +
    `text-anchor="middle" dominant-baseline="central">${escapeXml(initials)}</text>` +
    `</svg>`
  return Buffer.from(svg, 'utf8')
}

export default async function avatarRoutes(app) {
  // Current avatar state for the tab: which mode is active, the avatar authentik
  // resolves right now, and the Gravatar URL to preview/offer.
  app.get('/', async (request, reply) => {
    const session = await requireUser(request, reply)
    if (!session) {
      return
    }
    try {
      const full = await getUser(session.pk, clientFromRequest(request))
      const custom = full.attributes?.avatar || null
      const mode = modeFor(custom)
      return {
        // Every mode stores a URL now, so it's the shape of that URL that says which.
        mode,
        current: session.avatar || null,
        // Only surface a real upload here; a generated initials image isn't a picture.
        uploaded: mode === 'upload' ? custom : null,
        gravatar: gravatarUrl(session.email)
      }
    } catch (err) {
      if (err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
  })

  // Upload / replace the avatar. Body: { image: "data:image/...;base64,..." }.
  app.post('/', { bodyLimit: ROUTE_BODY_LIMIT }, async (request, reply) => {
    const session = await requireUser(request, reply)
    if (!session) {
      return
    }
    if (!storageConfigured()) {
      return reply.code(500).send({ error: 'Avatar uploads are not configured on this server' })
    }

    const parsed = parseDataUri(request.body?.image)
    if (!parsed) {
      return reply.badRequest('Provide an image as a base64 data URI')
    }
    if (!ALLOWED_INPUT.has(parsed.mime)) {
      return reply.badRequest('Unsupported image type — use PNG, JPEG or WebP')
    }
    if (parsed.buffer.length > MAX_INPUT_BYTES) {
      return reply.badRequest('That image is too large — please use one under 10 MB')
    }

    let webp
    try {
      webp = await toAvatarWebp(parsed.buffer)
    } catch {
      return reply.badRequest("That file couldn't be read as an image")
    }

    const client = clientFromRequest(request)
    try {
      // Read current attributes (me/ omits them) so the PATCH preserves the rest,
      // and so we can clean up the object the previous URL pointed at.
      const full = await getUser(session.pk, client)
      const previousKey = keyFromUrl(full.attributes?.avatar)

      const { key, url } = await putImage(session.pk, 'avatar', webp, shortHash(webp))
      await patchUser(session.pk, { attributes: { ...full.attributes, avatar: url } }, client)

      // Remove the superseded object (skip if the content was identical → same key).
      if (previousKey && previousKey !== key) {
        await deleteObject(previousKey)
      }
      return { avatar: url, mode: 'upload' }
    } catch (err) {
      if (err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
  })

  // Switch to Gravatar: store the computed Gravatar URL (rather than clearing the
  // attribute and leaning on authentik's fallback, so the value is always a URL we
  // chose), and delete whatever object the previous one pointed at.
  //
  // The URL hashes the address, so routes/email-change.js re-derives it when the
  // user's email changes.
  app.delete('/', async (request, reply) => {
    const session = await requireUser(request, reply)
    if (!session) {
      return
    }
    const client = clientFromRequest(request)
    try {
      const full = await getUser(session.pk, client)
      const previousKey = keyFromUrl(full.attributes?.avatar)

      const avatar = gravatarUrl(full.email || session.email)
      await patchUser(session.pk, { attributes: { ...full.attributes, avatar } }, client)

      if (previousKey) {
        await deleteObject(previousKey)
      }
      return { avatar, mode: 'gravatar' }
    } catch (err) {
      if (err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
  })

  // Switch to initials: generate a small SVG from the user's name, store it as an
  // object like an upload, and record its URL. Clean up the object the previous
  // avatar pointed at (a re-save with an unchanged name hashes to the same key, so
  // it's the same object and nothing is deleted).
  app.post('/initials', async (request, reply) => {
    const session = await requireUser(request, reply)
    if (!session) {
      return
    }
    if (!storageConfigured()) {
      return reply.code(500).send({ error: 'Avatar storage is not configured on this server' })
    }
    const client = clientFromRequest(request)
    try {
      const full = await getUser(session.pk, client)
      const previousKey = keyFromUrl(full.attributes?.avatar)

      const svg = initialsSvg(full)
      const { key, url } = await putImage(session.pk, INITIALS_VARIANT, svg, shortHash(svg), {
        contentType: 'image/svg+xml',
        extension: 'svg'
      })
      await patchUser(session.pk, { attributes: { ...full.attributes, avatar: url } }, client)

      if (previousKey && previousKey !== key) {
        await deleteObject(previousKey)
      }
      return { avatar: url, mode: 'initials' }
    } catch (err) {
      if (err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
  })
}
