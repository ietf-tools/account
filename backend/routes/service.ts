import type { FastifyInstance } from 'fastify'

import {
  findUserByUuid,
  getUser,
  getGroup,
  patchUser,
  revokeUserSessions,
  AuthentikError
} from '../lib/authentik.ts'
import type { AuthentikUser } from '../lib/authentik.ts'
import { requireServiceCaller } from '../lib/service-auth.ts'
import { config } from '../lib/config.ts'

/**
 * Service API for our other applications on the same authentik. Callers send an
 * authentik-issued bearer token: either a signed-in person's own access token from
 * the app's sign-in provider (admitted by group — e.g. a moderator acting in reef),
 * or the app's client_credentials token, for automation. See lib/service-auth.ts
 * for what is checked and the authentik-side setup each relies on.
 *
 * ── POST /deactivate-user ───────────────────────────────────────────────────────
 * Body: `{ uuid, reason? }`. `uuid` is the authentik user UUID, which the calling
 * apps receive as the `account_uuid` claim of the `profile` scope. Not `sub` (by
 * default a hash authentik computes on the fly, so it can't be looked up) and not
 * email/username (both change with a verified email change — routes/email-change.ts).
 *
 * Refused (403) for anything that isn't a regular person's account: superusers,
 * members of SERVICE_PROTECTED_GROUPS — directly or through any ancestor group, so
 * a sub-team of team-staff is covered — and service accounts. Group membership is
 * resolved fail-closed: if it can't be read, nothing is deactivated.
 *
 * Deactivating means:
 *   - `is_active: false`, which also blocks every sign-in path;
 *   - dropping `attributes.pending_verification`. With the marker still on, an
 *     inactive account reads as "not confirmed yet", and the recovery flow's email
 *     stage (`activate_user_on_success`) would let it reactivate itself — see
 *     authentik/ietf-flows/ietf-account-status.yaml. Spam accounts are exactly the
 *     ones likely never to have confirmed;
 *   - recording who asked and why in `attributes.deactivation`
 *     (`{ by: { app, user?, user_uuid? }, reason, at }` — `user` only when a person
 *     acted, i.e. a user token);
 *   - signing the user out everywhere (lib/authentik.ts revokeUserSessions).
 *
 * Idempotent: an account that is already deactivated keeps its original
 * `deactivation` record and only has its sessions swept again, so a caller that
 * got an error part-way (e.g. during revocation) can simply retry.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Free text from another app, stored on the user — keep it bounded.
const MAX_REASON_LENGTH = 500

// Only accounts of these authentik user types are people; service accounts
// (outposts, client_credentials callers) are never deactivated through here.
const PERSON_TYPES = new Set(['internal', 'external'])

/** The /deactivate-user body. */
interface DeactivateBody {
  uuid?: unknown
  reason?: unknown
}

// The first protected group the user is in, directly or through any ancestor, or
// null. A superuser group counts as protected whatever its name. Throws (rather
// than answering null) whenever membership can't be read, so a failure never
// reads as "not protected".
async function protectedGroupOf(user: AuthentikUser): Promise<string | null> {
  if (!Array.isArray(user.groups)) {
    throw new AuthentikError('authentik did not return the user’s group memberships', 502)
  }
  const protectedNames = new Set(config.service.protectedGroups)
  const seen = new Set<string>()
  const queue = [...user.groups]
  while (queue.length > 0) {
    const pk = String(queue.shift())
    if (seen.has(pk)) {
      continue
    }
    seen.add(pk)
    const group = await getGroup(pk)
    if (protectedNames.has(group.name) || group.is_superuser) {
      return group.name
    }
    // `parents` on authentik with multi-parent groups, `parent` before that.
    queue.push(...(group.parents ?? []))
    if (group.parent) {
      queue.push(group.parent)
    }
  }
  return null
}

export default async function serviceRoutes(app: FastifyInstance) {
  app.post<{ Body: DeactivateBody }>('/deactivate-user', async (request, reply) => {
    const caller = await requireServiceCaller(request, reply)
    if (!caller) {
      return
    }
    // Who to log and record: the app, plus the person when one acted through it.
    const actor = {
      app: caller.client.slug,
      ...(caller.user
        ? { user: caller.user.username ?? caller.user.sub, user_uuid: caller.user.uuid }
        : {})
    }

    const uuid = String(request.body?.uuid ?? '').trim().toLowerCase()
    if (!UUID_RE.test(uuid)) {
      return reply.badRequest('`uuid` must be an authentik user UUID')
    }
    const reason = String(request.body?.reason ?? '').trim().slice(0, MAX_REASON_LENGTH)

    try {
      const found = await findUserByUuid(uuid)
      if (!found) {
        return reply.notFound('No account with that UUID')
      }
      // The retrieve endpoint, for the full record (attributes + group pks) —
      // the PATCH below replaces `attributes` wholesale.
      const user = await getUser(found.pk)

      if (!PERSON_TYPES.has(String(user.type))) {
        return reply.forbidden('This account is a service account and cannot be deactivated here')
      }
      if (user.is_superuser) {
        return reply.forbidden('This account is protected and cannot be deactivated here')
      }
      const protectedGroup = await protectedGroupOf(user)
      if (protectedGroup) {
        request.log.warn(
          { actor, pk: user.pk, group: protectedGroup },
          'service: refused to deactivate a protected account'
        )
        return reply.forbidden('This account is protected and cannot be deactivated here')
      }

      const attributes = { ...user.attributes }
      const alreadyInactive = user.is_active === false && attributes.pending_verification == null
      if (!alreadyInactive) {
        delete attributes.pending_verification
        attributes.deactivation = {
          by: actor,
          reason,
          at: new Date().toISOString()
        }
        await patchUser(user.pk, { is_active: false, attributes })
      }
      const revoked = await revokeUserSessions(user)

      request.log.info(
        { actor, pk: user.pk, alreadyInactive, revoked, reason },
        'service: account deactivated'
      )
      return { deactivated: true, alreadyInactive, revoked }
    } catch (err) {
      if (err instanceof AuthentikError) {
        // Always a 502, whatever authentik answered: relaying its 403/404 would
        // read to the caller as "protected account" / "no such user".
        return reply.code(502).send({ error: err.message })
      }
      throw err
    }
  })
}
