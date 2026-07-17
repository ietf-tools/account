import { verifyLegacyCredentials, LegacyError } from '../lib/legacy.js'
import {
  findUserByEmail,
  findUserByUsername,
  createUser,
  setUserPassword,
  AuthentikError
} from '../lib/authentik.js'

/**
 * Legacy account migration — logic that deliberately lives in the backend.
 *
 * A user who existed in the old Django system enters their old credentials.
 * We verify them against the legacy system, and on success mint the equivalent
 * account in authentik (carrying over profile + a `migrated_from` marker) using
 * the service-account API token. The user keeps the same password unless they
 * choose a new one, and can immediately sign in through the normal flow.
 *
 * This runs as two steps:
 *   1. POST /migrate/validate — verify the legacy credentials and return the
 *      emails associated with the account. The verified profile (and password,
 *      needed to carry the credential over) is stashed server-side in the
 *      session for the completion step.
 *   2. POST /migrate — the user picks which of their emails to use for the new
 *      authentik account and optionally sets a new password; we create it.
 *
 * Nothing here is exposed to admins — it is purely a self-service path for
 * public users crossing over from the old system.
 */
export default async function migrationRoutes(app) {
  // Return the first of the given emails that already exists in authentik, if
  // any — used to detect an account that has already been migrated.
  async function firstMigratedEmail(emails) {
    for (const email of emails) {
      const user = await findUserByEmail(email)
      if (user) {
        return user
      }
    }
    return null
  }

  // Step 1: prove ownership against the legacy system and surface the account's
  // emails for the user to choose from.
  app.post('/validate', async (request, reply) => {
    const { identifier, password } = request.body ?? {}
    if (!identifier || !password) {
      return reply.badRequest('identifier and password are required')
    }

    try {
      const legacy = await verifyLegacyCredentials(identifier, password)
      if (!legacy) {
        return reply.unauthorized('Those legacy credentials were not recognised')
      }
      if (!legacy.emails.length) {
        return reply.badRequest('No email addresses are associated with this account')
      }

      // Don't double-migrate — send already-migrated users to sign in.
      const existing =
        (legacy.username ? await findUserByUsername(legacy.username) : null) ??
        (await firstMigratedEmail(legacy.emails))
      if (existing) {
        return reply.conflict('This account has already been migrated — please sign in')
      }

      // Stash the verified profile + password for the completion step so the
      // browser never has to re-send the credential.
      request.session.migration = { legacy, password }

      return { emails: legacy.emails, username: legacy.username }
    } catch (err) {
      if (err instanceof LegacyError || err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
  })

  // Step 2: create the authentik account using the chosen email.
  app.post('/migrate', async (request, reply) => {
    const { email, newPassword } = request.body ?? {}
    const pending = request.session.migration
    if (!pending) {
      return reply.badRequest('Please validate your credentials first')
    }

    const { legacy, password } = pending
    if (!email || !legacy.emails.includes(email)) {
      return reply.badRequest('Please choose one of your account emails')
    }

    try {
      // Guard against a race where the account got migrated in the meantime.
      const existing =
        (await findUserByEmail(email)) ??
        (legacy.username ? await findUserByUsername(legacy.username) : null)
      if (existing) {
        request.session.migration = null
        return reply.conflict('This account has already been migrated — please sign in')
      }

      // Recreate the account in authentik and set the password.
      const created = await createUser({
        username: legacy.username,
        email,
        name: legacy.name,
        attributes: legacy.attributes
      })
      await setUserPassword(created.pk, newPassword || password)

      request.session.migration = null

      return {
        migrated: true,
        username: created.username,
        email: created.email
      }
    } catch (err) {
      if (err instanceof LegacyError || err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
  })
}
