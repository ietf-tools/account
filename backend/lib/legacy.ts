import { config } from './config.ts'

/**
 * Client for the legacy Datatracker system.
 *
 * This is the piece of business logic that MUST live in the backend: verifying
 * a user's credentials against the old system before we recreate their account
 * in authentik. The exact transport depends on your legacy setup — this
 * implementation assumes the old system exposes a small internal HTTP API:
 *
 *   POST <LEGACY_API_URL>/verify  { username_or_email, password }
 *        -> 200 { username, email | emails[], name, ...profile } on success
 *        -> 401 on bad credentials
 *
 * A Datatracker account can have several email addresses associated with it, so
 * the profile may carry an `emails` array; a lone `email` is treated as a
 * single-element list.
 *
 * Swap the body of these functions for a direct DB read, an LDAP bind, or
 * whatever the legacy system actually offers. The rest of the migration flow
 * (routes/migration.ts) only depends on the shape returned here.
 */

/**
 * The normalised legacy profile the migration flow works from — see the header
 * for the legacy API's own (looser) response shape.
 */
export interface LegacyProfile {
  username: string
  emails: string[]
  name: string
  attributes: Record<string, unknown>
}

/** The legacy API's `/verify` response, as far as we read it. */
interface LegacyVerifyResponse {
  username: string
  email?: string
  emails?: string[]
  name?: string
  full_name?: string
  id?: string | number
  pk?: string | number
  attributes?: Record<string, unknown>
}

function legacyEnabled(): boolean {
  return Boolean(config.legacy.apiUrl)
}

/**
 * Verify legacy credentials. Returns the legacy profile on success, or `null`
 * if the credentials are wrong / the account does not exist.
 */
export async function verifyLegacyCredentials(
  identifier: string,
  password: string
): Promise<LegacyProfile | null> {
  if (!legacyEnabled()) {
    throw new LegacyError('Legacy migration is not configured (set LEGACY_API_URL)', 501)
  }

  const response = await fetch(`${config.legacy.apiUrl.replace(/\/+$/, '')}/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.legacy.apiToken ? { Authorization: `Token ${config.legacy.apiToken}` } : {})
    },
    body: JSON.stringify({ username_or_email: identifier, password })
  })

  if (response.status === 401 || response.status === 404) return null
  if (!response.ok) {
    throw new LegacyError(`Legacy system error (HTTP ${response.status})`, 502)
  }

  const profile = (await response.json()) as LegacyVerifyResponse
  // A Datatracker account can own multiple emails. Normalise to a de-duplicated
  // list, accepting either an `emails` array or a single `email`.
  const emails = [
    ...new Set(
      (Array.isArray(profile.emails) ? profile.emails : [profile.email]).filter(
        (email): email is string => Boolean(email)
      )
    )
  ]
  return {
    username: profile.username,
    emails,
    name: profile.name ?? profile.full_name ?? profile.username,
    // Anything else worth carrying over lands in authentik user attributes.
    attributes: {
      legacy_id: profile.id ?? profile.pk ?? null,
      migrated_from: 'datatracker',
      ...profile.attributes
    }
  }
}

export class LegacyError extends Error {
  status: number

  constructor(message: string, status = 502) {
    super(message)
    this.name = 'LegacyError'
    this.status = status
  }
}
