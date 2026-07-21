import sharp from 'sharp'

import { getUser, patchUser, clientFromRequest, AuthentikError } from '../lib/authentik.js'
import { gravatarUrl } from '../lib/gravatar.js'
import { storageConfigured, putImage, deleteObject, keyFromUrl } from '../lib/storage.js'
import { ALLOWED_INPUT, parseDataUri, shortHash, requireUser } from '../lib/imageUpload.js'

/**
 * Avatar management — a custom, backend-only feature (like migration, it needs
 * the admin API token, so it can't run browser-direct the way the auth flows do).
 *
 * The user chooses between three modes:
 *   • Gravatar — no upload; we clear attributes.avatar so authentik's AVATARS
 *     fallback (attributes.avatar,gravatar,initials) resolves to their Gravatar.
 *   • Upload   — we normalise the image (EXIF-rotate, square-crop, resize,
 *     re-encode to WebP), store it in object storage under a content-hashed key,
 *     and put its *URL* (not the bytes) in attributes.avatar.
 *   • Initials — we generate a small SVG of the user's initials and store it as a
 *     data-URI directly in attributes.avatar. It's tiny, needs no object storage,
 *     and (because it populates attributes.avatar) wins over Gravatar in the chain
 *     above without any authentik reconfiguration. On read we recognise it by its
 *     `data:image/svg+xml` prefix — uploads are always http(s) storage URLs.
 *
 * Storing a URL rather than a data URI keeps the value small and cacheable
 * wherever authentik surfaces `user.avatar` — notably the OIDC `picture` claim
 * consumed by other apps. See routes/portrait.js for the companion full-size
 * picture (aspect-preserving, upload-only, stored in attributes.portrait).
 *
 * Deployment notes:
 *   • authentik's AVATARS setting must include `attributes.avatar` before
 *     `gravatar` (e.g. `attributes.avatar,gravatar,initials`) so an upload wins
 *     and removing it falls back to Gravatar.
 *   • Add/adjust an OIDC property mapping to emit `{"picture": request.user.avatar}`
 *     so other apps receive the resolved URL.
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

// An avatar value we generated for the "initials" mode: an inline SVG data-URI.
// Uploads are always http(s) storage URLs, so this prefix reliably distinguishes
// the two on read.
const INITIALS_PREFIX = 'data:image/svg+xml'

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

// Build an initials avatar as an SVG data-URI (base64) suitable for storing in
// attributes.avatar. Square, centred glyphs on a solid deterministic background.
function initialsDataUri(user) {
  const initials = initialsFor(user)
  const hue = hueFor(user?.email || user?.username || initials)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" ` +
    `viewBox="0 0 ${AVATAR_SIZE} ${AVATAR_SIZE}">` +
    `<rect width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" fill="hsl(${hue}, 60%, 45%)"/>` +
    `<text x="50%" y="50%" fill="#ffffff" font-size="110" font-weight="600" ` +
    `font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" ` +
    `text-anchor="middle" dominant-baseline="central">${initials}</text>` +
    `</svg>`
  return `${INITIALS_PREFIX};base64,${Buffer.from(svg, 'utf8').toString('base64')}`
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
      const isInitials = typeof custom === 'string' && custom.startsWith(INITIALS_PREFIX)
      return {
        // Initials are stored in attributes.avatar too, so distinguish by prefix.
        mode: isInitials ? 'initials' : custom ? 'upload' : 'gravatar',
        current: session.avatar || null,
        // Only surface a real upload here; an initials data-URI isn't a picture.
        uploaded: isInitials ? null : custom,
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

  // Switch to Gravatar: drop the custom avatar so authentik's AVATARS fallback
  // resolves to Gravatar, and delete the stored object.
  app.delete('/', async (request, reply) => {
    const session = await requireUser(request, reply)
    if (!session) {
      return
    }
    const client = clientFromRequest(request)
    try {
      const full = await getUser(session.pk, client)
      const previousKey = keyFromUrl(full.attributes?.avatar)

      const attributes = { ...full.attributes }
      delete attributes.avatar
      await patchUser(session.pk, { attributes }, client)

      if (previousKey) {
        await deleteObject(previousKey)
      }
      return { avatar: gravatarUrl(session.email), mode: 'gravatar' }
    } catch (err) {
      if (err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
  })

  // Switch to initials: generate a small SVG data-URI from the user's name and
  // store it in attributes.avatar (no object storage needed). Clean up any object
  // a prior uploaded avatar pointed at.
  app.post('/initials', async (request, reply) => {
    const session = await requireUser(request, reply)
    if (!session) {
      return
    }
    const client = clientFromRequest(request)
    try {
      const full = await getUser(session.pk, client)
      const previousKey = keyFromUrl(full.attributes?.avatar)

      const avatar = initialsDataUri(full)
      await patchUser(session.pk, { attributes: { ...full.attributes, avatar } }, client)

      if (previousKey) {
        await deleteObject(previousKey)
      }
      return { avatar, mode: 'initials' }
    } catch (err) {
      if (err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
  })
}
