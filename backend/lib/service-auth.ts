import type { FastifyReply, FastifyRequest } from 'fastify'
import { createRemoteJWKSet, decodeJwt, errors, jwtVerify } from 'jose'
import type { JWTPayload } from 'jose'

import { config } from './config.ts'
import { errorMessage } from './errors.ts'

/**
 * Authenticating our *other* applications to the service API — see
 * routes/service.ts. Every caller already lives on the same authentik, so rather
 * than a pre-shared key we accept tokens authentik itself issued, of two kinds:
 *
 * ── User tokens (SERVICE_API_USER_CLIENTS) ─────────────────────────────────────
 * A person signed in to the calling app (e.g. reef) acts through it: the app
 * forwards *that person's* access token from its own sign-in provider. Admitted
 * only when the token's `groups` claim (the `profile` scope mapping, which lists
 * every group including inherited ones) names one of SERVICE_API_USER_GROUPS — so
 * the permission follows authentik group membership, and the audit record names
 * the person, not just the app.
 *
 * Two consequences to know about:
 *   - the claim is a snapshot taken when the token was issued: someone removed from
 *     the group keeps the power until their access token expires, so keep that
 *     provider's access token validity short;
 *   - we accept a token whose audience is the *app*, not this API (authentik has no
 *     token exchange to mint one for us). Whoever holds it — the app, or the person
 *     themselves — can call us with it, which is fine only because the group check
 *     is what grants the right, not which app is calling.
 *
 * ── Client tokens (SERVICE_API_CLIENTS) ─────────────────────────────────────────
 * The app on its own behalf, for automation: an access token from the
 * `client_credentials` grant (client id + secret) on a provider **dedicated** to
 * this API. No group check — being that provider's client is the permission. The
 * checks below can't tell a client_credentials token from a *user's* token of the
 * same provider, so that provider serves nothing else and its application is
 * policy-bound to its own service account. Never list a sign-in provider here: any
 * of its users' tokens would pass. (Booting refuses a client id in both lists.)
 *
 * ── What every token has to prove ───────────────────────────────────────────────
 *   - its signature, against `/application/o/<slug>/jwks/` (asymmetric algorithms
 *     only: a provider with no signing key falls back to HS256 keyed by the client
 *     secret, which we refuse rather than share the secret);
 *   - `aud` (and `azp`, when present) is that provider's client id — authentik
 *     stamps every token a provider issues with its own client id, so this is what
 *     says *which* provider minted it;
 *   - `iss` is that provider's issuer. Only the path is compared: authentik builds
 *     the issuer from the host the token was *requested* at, which is the caller's
 *     business, and the signature plus `aud` already pin the provider. This assumes
 *     per-provider issuer mode (authentik's default); global mode is rejected;
 *   - `exp` (required), with a little clock skew allowed.
 */

/** A provider whose tokens are accepted, as configured. */
export interface ServiceClient {
  /** The authentik application slug — also what we log and record as the app. */
  slug: string
  clientId: string
  /** `user`: a signed-in person's token (group-gated). `client`: client_credentials. */
  kind: 'user' | 'client'
}

/** Who is calling: the app, and — for a user token — the person acting through it. */
export interface ServiceCaller {
  client: ServiceClient
  user: {
    sub: string
    username?: string
    /** The `account_uuid` claim, when the provider's profile mapping emits it. */
    uuid?: string
  } | null
}

const clients: ServiceClient[] = [
  ...config.service.clients.map((c) => ({ ...c, kind: 'client' as const })),
  ...config.service.userClients.map((c) => ({ ...c, kind: 'user' as const }))
]
// A provider in both lists would let any of its users in as the app itself — the
// group gate would be skipped by whichever entry matched first. Refuse to boot.
for (const client of config.service.userClients) {
  if (config.service.clients.some((c) => c.clientId === client.clientId)) {
    throw new Error(
      `Client id of "${client.slug}" is in both SERVICE_API_CLIENTS and SERVICE_API_USER_CLIENTS`
    )
  }
}

// Only asymmetric signatures (see the header for why HS256 is refused).
const ALGORITHMS = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512', 'PS256', 'PS384', 'PS512']

// One remote key set per configured provider. jose caches the keys and refetches
// (rate limited) when a token names a key id it hasn't seen — i.e. a key rotation.
const keySets = new Map(
  clients.map((client) => [
    client.clientId,
    createRemoteJWKSet(new URL(`${config.authentik.url}/application/o/${client.slug}/jwks/`))
  ])
)

// The errors that mean "this token is no good", as opposed to "we couldn't check"
// (authentik unreachable, JWKS unreadable) — the former is a 401 for the caller to
// fix, the latter a 502 they can retry.
const TOKEN_ERROR_CODES = new Set([
  'ERR_JWT_INVALID',
  'ERR_JWS_INVALID',
  'ERR_JWT_EXPIRED',
  'ERR_JWT_CLAIM_VALIDATION_FAILED',
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JWKS_NO_MATCHING_KEY',
  'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
  'ERR_JOSE_ALG_NOT_ALLOWED',
  'ERR_JOSE_NOT_SUPPORTED'
])

export class ServiceAuthError extends Error {
  status: number

  constructor(message: string, status = 401) {
    super(message)
    this.name = 'ServiceAuthError'
    this.status = status
  }
}

// Verify signature and the standard claims against one configured provider.
async function verifyFor(
  request: FastifyRequest,
  client: ServiceClient,
  token: string
): Promise<JWTPayload> {
  const keySet = keySets.get(client.clientId)
  if (!keySet) {
    throw new ServiceAuthError('This application is not allowed to use the service API')
  }
  let payload: JWTPayload
  try {
    ;({ payload } = await jwtVerify(token, keySet, {
      algorithms: ALGORITHMS,
      audience: client.clientId,
      requiredClaims: ['exp', 'iss', 'sub'],
      clockTolerance: '30s'
    }))
  } catch (err) {
    if (err instanceof errors.JOSEError && TOKEN_ERROR_CODES.has(err.code)) {
      throw new ServiceAuthError(`Invalid access token: ${err.message}`)
    }
    request.log.warn({ client: client.slug, err: errorMessage(err) }, 'service-auth: verification failed')
    throw new ServiceAuthError('Could not verify the access token', 502)
  }
  if (payload.azp !== undefined && payload.azp !== client.clientId) {
    throw new ServiceAuthError('Access token was issued to a different client')
  }
  let issuerPath = ''
  try {
    issuerPath = new URL(String(payload.iss)).pathname
  } catch {
    // Not a URL — falls through to the mismatch below.
  }
  if (issuerPath !== `/application/o/${client.slug}/`) {
    throw new ServiceAuthError('Access token was not issued by the expected provider')
  }
  return payload
}

/**
 * Verify the request's bearer token and return who is calling. Throws
 * ServiceAuthError: 401 for a missing/invalid token, 403 for a valid user token
 * without an allowed group, 502 when the keys can't be fetched.
 */
export async function authenticateServiceCaller(request: FastifyRequest): Promise<ServiceCaller> {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '')
  if (!match) {
    throw new ServiceAuthError('A bearer access token is required')
  }
  const token = match[1]

  // Read `aud`/`azp` unverified purely to pick which provider's keys to check the
  // token against; verifyFor re-checks the audience on the verified payload.
  let audiences: string[]
  try {
    const unverified = decodeJwt(token)
    audiences = [unverified.aud ?? []].flat()
    if (typeof unverified.azp === 'string') {
      audiences.push(unverified.azp)
    }
  } catch {
    throw new ServiceAuthError('Malformed access token')
  }
  const client = clients.find((c) => audiences.includes(c.clientId))
  if (!client) {
    throw new ServiceAuthError('This application is not allowed to use the service API')
  }

  const payload = await verifyFor(request, client, token)
  if (client.kind === 'client') {
    return { client, user: null }
  }

  const groups = Array.isArray(payload.groups) ? payload.groups : []
  if (!groups.some((group) => config.service.userGroups.includes(String(group)))) {
    throw new ServiceAuthError('You are not allowed to use the service API', 403)
  }
  return {
    client,
    user: {
      sub: String(payload.sub),
      username: typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined,
      uuid: typeof payload.account_uuid === 'string' ? payload.account_uuid : undefined
    }
  }
}

/**
 * Route-level guard in the style of the session routes' `requireCaller`: returns
 * the caller, or replies with the error and returns null.
 */
export async function requireServiceCaller(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<ServiceCaller | null> {
  try {
    return await authenticateServiceCaller(request)
  } catch (err) {
    if (err instanceof ServiceAuthError) {
      if (err.status === 401) {
        reply.header('WWW-Authenticate', 'Bearer')
      }
      reply.code(err.status).send({ error: err.message })
      return null
    }
    throw err
  }
}
