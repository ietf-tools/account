import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'

import { config } from './config.ts'

/**
 * S3-compatible object storage for uploaded avatars (AWS S3, MinIO, …).
 *
 * The point of storing avatars as objects rather than as a base64 data URI on
 * the authentik user: the value we hand authentik (and thus every downstream app
 * via the OIDC `picture` claim) is a small, cacheable URL, not the image bytes.
 * The object key carries a content hash, so each distinct image gets a unique,
 * immutably-cacheable URL and re-uploads never serve stale bytes.
 */

const { storage } = config

let client: S3Client | null = null

// Configured only when a bucket, credentials, and a public base URL are all set.
// Avatar upload requires this; the rest of the app (and Gravatar mode) does not.
export function storageConfigured(): boolean {
  return Boolean(
    storage.bucket && storage.accessKeyId && storage.secretAccessKey && storage.publicUrl
  )
}

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: storage.region,
      // Only set endpoint/path-style for non-AWS S3s (MinIO etc.).
      ...(storage.endpoint ? { endpoint: storage.endpoint, forcePathStyle: storage.forcePathStyle } : {}),
      credentials: {
        accessKeyId: storage.accessKeyId,
        secretAccessKey: storage.secretAccessKey
      }
    })
  }
  return client
}

// Public URL other apps fetch the object from: <publicUrl>/<key>.
export function publicUrlFor(key: string): string {
  return `${storage.publicUrl}/${key}`
}

// If `url` points at our own storage, return its object key; otherwise null.
// Used to delete the previous object on re-upload / removal without tracking the
// key separately (we derive it from the URL currently on the user).
export function keyFromUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !storage.publicUrl || !url.startsWith(`${storage.publicUrl}/`)) {
    return null
  }
  return url.slice(storage.publicUrl.length + 1)
}

/** How a stored object is typed and named; defaults to the routes' WebP. */
interface StoredImageOptions {
  contentType?: string
  extension?: string
}

// Store the (already-processed) image bytes under a content-hashed key and
// return both the key and its public URL. `variant` distinguishes the kinds we
// store per user (e.g. 'avatar', 'avatar-initials', 'portrait') and is part of
// the key, so a route can tell which kind a stored URL is just by reading it
// back. Long, immutable cache headers are safe because the hash makes the key
// unique to the content. Defaults are the WebP the upload routes produce;
// generated SVGs pass their own type/extension.
export async function putImage(
  userPk: string | number,
  variant: string,
  buffer: Buffer,
  contentHash: string,
  { contentType = 'image/webp', extension = 'webp' }: StoredImageOptions = {}
): Promise<{ key: string; url: string }> {
  const key = `${storage.keyPrefix}${userPk}-${variant}-${contentHash}.${extension}`
  await getClient().send(
    new PutObjectCommand({
      Bucket: storage.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable'
    })
  )
  return { key, url: publicUrlFor(key) }
}

// Best-effort delete of a previously stored object; a failure here shouldn't
// fail the surrounding operation (the attribute update is what matters).
export async function deleteObject(key: string | null): Promise<void> {
  if (!key) {
    return
  }
  try {
    await getClient().send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: key }))
  } catch {
    // Orphaned object at worst — ignore.
  }
}
