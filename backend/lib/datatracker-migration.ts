import { constants, createPublicKey, publicEncrypt } from 'node:crypto'
import type { KeyObject } from 'node:crypto'

import { config } from './config.ts'

/**
 * Client for Datatracker's account-migration API.
 *
 * This is the piece of the migration that MUST live in the backend: proving a
 * person's existing Datatracker password before we build them an account over
 * here. The browser never talks to Datatracker — it holds the API key, and the
 * password is encrypted to Datatracker's public key on this side.
 *
 *   POST <DATATRACKER_MIGRATION_API_ENDPOINT>
 *        X-Api-Key: <DATATRACKER_MIGRATION_API_TOKEN>
 *        { username_or_email, encrypted_password }
 *     -> 200 with the Person behind the credentials (see DatatrackerPerson)
 *     -> 400 { errors: [{ code: "verification_failed" }] }      bad credentials
 *     -> 400 { errors: [{ code: "undecryptable_password" }] }   OUR key is wrong
 *
 * `encrypted_password` is the password encrypted to Datatracker's public key
 * with RSA-OAEP (SHA-256 for both the digest and MGF1, no label), base64
 * encoded. There is no plaintext alternative: Datatracker refuses an
 * unencrypted password like any other envelope it cannot open.
 *
 * The response is deliberately Person-scoped — no Datatracker username, no
 * password material, no database keys beyond `legacy_sub`.
 */

/** One of the Person's email addresses, as Datatracker reports it. */
export interface DatatrackerEmail {
  address: string
  primary: boolean
  active: boolean
}

/** Datatracker keeps the name pre-split; we don't re-derive any of it. */
export interface DatatrackerName {
  full: string
  plain: string
  first: string
  last: string
}

/** The account the credentials proved, as much of it as enrollment needs. */
export interface DatatrackerPerson {
  /** Null only when the Person's UUID rows are inconsistent on their side. */
  person_uuid: string | null
  name: DatatrackerName
  /** Every address of the Person, primary first; inactive ones included. */
  emails: DatatrackerEmail[]
  pronouns: string | null
  github_username: string | null
  portrait_url: string | null
  /** The subject Datatracker used to issue for this account. */
  legacy_sub: string
  last_login: string | null
  /** True ⇒ the Person already has an account; enrollment must stop. */
  already_linked: boolean
}

/**
 * A DRF "standardized errors" body, as far as we read it:
 *   { type: "validation_error", errors: [{ code, detail, attr }] }
 */
interface DatatrackerErrorBody {
  type?: string
  errors?: { code?: string; detail?: string; attr?: string | null }[]
  detail?: string
}

export class DatatrackerMigrationError extends Error {
  status: number
  /** Datatracker's own error code, when it gave one (e.g. undecryptable_password). */
  code: string | null

  constructor(message: string, status = 502, code: string | null = null) {
    super(message)
    this.name = 'DatatrackerMigrationError'
    this.status = status
    this.code = code
  }
}

function migrationEnabled(): boolean {
  return Boolean(config.datatrackerMigration.endpoint && config.datatrackerMigration.publicKey)
}

// Parsing the PEM costs a little, and the key never changes for the life of the
// process — but do it lazily so a malformed key surfaces on the first migration
// attempt rather than at import time (nothing else in the backend needs it).
let cachedKey: KeyObject | null = null

function publicKey(): KeyObject {
  if (!cachedKey) {
    cachedKey = createPublicKey(config.datatrackerMigration.publicKey)
  }
  return cachedKey
}

/**
 * The password sealed for Datatracker: RSA-OAEP with SHA-256 as both the OAEP
 * digest and the MGF1 hash, no label, base64 encoded.
 *
 * Node has no separate MGF1 option — OpenSSL defaults the MGF1 digest to the
 * OAEP one, so `oaepHash: 'sha256'` sets both, and omitting `oaepLabel` is the
 * "no label" Datatracker expects.
 */
export function encryptPassword(password: string): string {
  return publicEncrypt(
    {
      key: publicKey(),
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256'
    },
    Buffer.from(password, 'utf8')
  ).toString('base64')
}

// The error code Datatracker returned, if the body was one of its standardized
// error payloads.
async function errorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as DatatrackerErrorBody
    return body.errors?.[0]?.code ?? null
  } catch {
    return null
  }
}

/**
 * Prove a Datatracker login. Returns the Person behind it, or `null` if the
 * credentials were not accepted.
 *
 * Every credential failure is the same answer by design — an unknown address, a
 * wrong password and a disabled account are indistinguishable, so this cannot be
 * used to discover which addresses exist. Anything else (a rejected API key, a
 * key mismatch, Datatracker being down) throws, because none of it is something
 * the person at the keyboard can fix.
 */
export async function verifyDatatrackerCredentials(
  identifier: string,
  password: string
): Promise<DatatrackerPerson | null> {
  if (!migrationEnabled()) {
    throw new DatatrackerMigrationError(
      'Datatracker migration is not configured (set DATATRACKER_MIGRATION_API_ENDPOINT and DATATRACKER_MIGRATION_PUBLIC_KEY)',
      501
    )
  }

  const response = await fetch(config.datatrackerMigration.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Api-Key': config.datatrackerMigration.apiToken
    },
    body: JSON.stringify({
      username_or_email: identifier,
      encrypted_password: encryptPassword(password)
    })
  })

  if (response.status === 400) {
    const code = await errorCode(response)
    if (code === 'undecryptable_password') {
      // Datatracker could not open the envelope: the key we hold is not the one
      // it holds. That is our misconfiguration, not a wrong password — worth
      // alerting on, and never worth showing the person as a credential error.
      throw new DatatrackerMigrationError(
        'Datatracker could not decrypt the password — DATATRACKER_MIGRATION_PUBLIC_KEY does not match its private key',
        502,
        code
      )
    }
    return null
  }

  if (response.status === 401 || response.status === 403) {
    throw new DatatrackerMigrationError(
      'Datatracker rejected our migration API key (check DATATRACKER_MIGRATION_API_TOKEN)',
      502
    )
  }

  if (!response.ok) {
    throw new DatatrackerMigrationError(`Datatracker migration API error (HTTP ${response.status})`, 502)
  }

  const person = (await response.json()) as DatatrackerPerson
  return {
    ...person,
    emails: Array.isArray(person.emails) ? person.emails : []
  }
}
