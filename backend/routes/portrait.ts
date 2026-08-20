import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'

import { getUser, patchUser, clientFromRequest, AuthentikError } from '../lib/authentik.ts'
import { storageConfigured, putImage, deleteObject, keyFromUrl } from '../lib/storage.ts'
import { ALLOWED_INPUT, parseDataUri, shortHash, requireUser } from '../lib/imageUpload.ts'

/**
 * Portrait picture — a higher-resolution, full-frame photo of the user, stored
 * alongside the avatar but kept separate:
 *   • upload-only (no Gravatar / initials fallback),
 *   • aspect ratio preserved (no square crop),
 *   • its URL saved in the `attributes.portrait` user field.
 *
 * Same object-storage/CDN backend as the avatar (see routes/avatar.ts): we store
 * the processed bytes and record only the URL, so the value stays small and
 * cacheable wherever it's surfaced (expose it to other apps with an OIDC property
 * mapping, e.g. `{"portrait": request.user.attributes.get("portrait")}`).
 */

// Longest-edge cap. Large enough to look good full-size, bounded so a stored
// portrait stays a sensible size. Smaller images are never upscaled.
const PORTRAIT_MAX_EDGE = 1600
const MAX_INPUT_BYTES = 15 * 1024 * 1024
const ROUTE_BODY_LIMIT = 25 * 1024 * 1024

// Normalise into WebP while preserving aspect ratio: honour EXIF orientation, fit
// within a PORTRAIT_MAX_EDGE box without enlarging, re-encode (also strips
// metadata and any non-image payload).
async function toPortraitWebp(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer, { animated: false })
    .rotate()
    .resize(PORTRAIT_MAX_EDGE, PORTRAIT_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer()
}

/** An upload's body: the picture as a base64 data URI. */
interface ImageBody {
  image?: unknown
}

export default async function portraitRoutes(app: FastifyInstance) {
  // Whether the user currently has a portrait, and its URL.
  app.get('/', async (request, reply) => {
    const session = await requireUser(request, reply)
    if (!session) {
      return
    }
    try {
      const full = await getUser(session.pk, clientFromRequest(request))
      return { portrait: full.attributes?.portrait || null }
    } catch (err) {
      if (err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
  })

  // Upload / replace the portrait. Body: { image: "data:image/...;base64,..." }.
  app.post<{ Body: ImageBody }>('/', { bodyLimit: ROUTE_BODY_LIMIT }, async (request, reply) => {
    const session = await requireUser(request, reply)
    if (!session) {
      return
    }
    if (!storageConfigured()) {
      return reply.code(500).send({ error: 'Picture uploads are not configured on this server' })
    }

    const parsed = parseDataUri(request.body?.image)
    if (!parsed) {
      return reply.badRequest('Provide an image as a base64 data URI')
    }
    if (!ALLOWED_INPUT.has(parsed.mime)) {
      return reply.badRequest('Unsupported image type — use PNG, JPEG or WebP')
    }
    if (parsed.buffer.length > MAX_INPUT_BYTES) {
      return reply.badRequest('That image is too large — please use one under 15 MB')
    }

    let webp
    try {
      webp = await toPortraitWebp(parsed.buffer)
    } catch {
      return reply.badRequest("That file couldn't be read as an image")
    }

    const client = clientFromRequest(request)
    try {
      const full = await getUser(session.pk, client)
      const previousKey = keyFromUrl(full.attributes?.portrait)

      const { key, url } = await putImage(session.pk, 'portrait', webp, shortHash(webp))
      await patchUser(session.pk, { attributes: { ...full.attributes, portrait: url } }, client)

      if (previousKey && previousKey !== key) {
        await deleteObject(previousKey)
      }
      return { portrait: url }
    } catch (err) {
      if (err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
  })

  // Remove the portrait entirely (no fallback — the field is simply cleared).
  app.delete('/', async (request, reply) => {
    const session = await requireUser(request, reply)
    if (!session) {
      return
    }
    const client = clientFromRequest(request)
    try {
      const full = await getUser(session.pk, client)
      const previousKey = keyFromUrl(full.attributes?.portrait)

      const attributes = { ...full.attributes }
      delete attributes.portrait
      await patchUser(session.pk, { attributes }, client)

      if (previousKey) {
        await deleteObject(previousKey)
      }
      return { portrait: null }
    } catch (err) {
      if (err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
  })
}
