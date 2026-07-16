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
 * Nothing here is exposed to admins — it is purely a self-service path for
 * public users crossing over from the old system.
 */
export default async function migrationRoutes(app) {
  app.post('/migrate', async (request, reply) => {
    const { identifier, password, newPassword } = request.body ?? {}
    if (!identifier || !password) {
      return reply.badRequest('identifier and password are required')
    }

    try {
      // 1. Prove ownership against the legacy system.
      const legacy = await verifyLegacyCredentials(identifier, password)
      if (!legacy) {
        return reply.unauthorized('Those legacy credentials were not recognised')
      }

      // 2. Don't double-migrate — send already-migrated users to sign in.
      const existing =
        (await findUserByEmail(legacy.email)) ??
        (legacy.username ? await findUserByUsername(legacy.username) : null)
      if (existing) {
        return reply.conflict('This account has already been migrated — please sign in')
      }

      // 3. Recreate the account in authentik and set the password.
      const created = await createUser({
        username: legacy.username,
        email: legacy.email,
        name: legacy.name,
        attributes: legacy.attributes
      })
      await setUserPassword(created.pk, newPassword || password)

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
