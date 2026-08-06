import { resolveSessionUser, getUser, clientFromRequest, AuthentikError } from '../lib/authentik.js'

/**
 * Read-only view of the caller's Datatracker link state (`attributes.datatracker`).
 *
 * Exists purely because the browser cannot see user attributes: authentik's self
 * serializer at /core/users/me/ omits `attributes` entirely, so the SPA has no way
 * to tell whether an account has already been linked to a legacy Datatracker
 * account. The Connected Services page uses this to decide whether to offer the
 * migration at all — see frontend/composables/useDatatrackerLink.js.
 *
 * The caller is resolved from their own authentik session cookie, so this can only
 * ever report on their own account. Reading the attribute itself needs the admin
 * token (hence `getUser`), but nothing here writes.
 */
export default async function datatrackerRoutes(app) {
  // Matches the shape written by the migration flow's user_write stage.
  const ATTRIBUTE_KEY = 'datatracker'

  app.get('/', async (request, reply) => {
    let user = null
    try {
      user = await resolveSessionUser(request.headers.cookie, clientFromRequest(request))
    } catch (err) {
      if (err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
    if (!user) {
      return reply.unauthorized('You must be signed in to view your Datatracker link')
    }

    try {
      const full = await getUser(user.pk, clientFromRequest(request))
      const stored = full.attributes?.[ATTRIBUTE_KEY]
      const linked =
        stored && typeof stored === 'object' && !Array.isArray(stored)
          ? Boolean(stored.linked)
          : false
      return { linked }
    } catch (err) {
      if (err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
  })
}
