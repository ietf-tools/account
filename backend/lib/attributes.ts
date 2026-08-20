/**
 * Reading authentik's free-form user `attributes`.
 *
 * `attributes` is a JSON field on the authentik user: whatever has been written
 * there is whatever comes back, so every value we read out of it is `unknown` as
 * far as this app is concerned. Blueprint policies, source property mappings,
 * earlier versions of this backend and hand edits in authentik's admin UI all
 * write into the same object, so a key can legitimately hold a shape we don't
 * expect — see lib/recovery-emails.ts, which tolerates two shapes for exactly
 * that reason.
 *
 * These are the narrowing helpers the routes share so they all read it the same
 * way, rather than each asserting its own shape.
 */

/** The shape of `user.attributes` itself, and of any object nested in it. */
export type Attributes = Record<string, unknown>

/**
 * Is this a plain JSON object (not null, not an array)? Arrays are excluded
 * because a value spread as an object is meant to be a mapping —
 * `attributes.github` and `attributes.datatracker` both are.
 */
export function isPlainObject(value: unknown): value is Attributes {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * A stored attribute read as a plain object, or `{}` if it holds anything else.
 * Lets a caller spread the current value without asserting it was ever written
 * in the shape this app expects.
 */
export function plainObject(value: unknown): Attributes {
  return isPlainObject(value) ? value : {}
}
