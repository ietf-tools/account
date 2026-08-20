import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import {
  resolveSessionUser,
  userApiGet,
  getUser,
  patchUser,
  clientFromRequest,
  AuthentikError
} from '../lib/authentik.ts'
import type { AuthentikUser, ClientIdentity } from '../lib/authentik.ts'
import { plainObject } from '../lib/attributes.ts'
import { fetchGithubUserById, GithubError } from '../lib/github.ts'

/**
 * Fill in `attributes.github` for a signed-in user from their linked GitHub source
 * connection — the "refresh" button on the Connected Services page.
 *
 * Why this exists: authentik's source property mappings only reach the user object
 * through a flow's `user_write` stage, and a flow only runs on two of the three
 * source paths — *enrollment* (signing up with GitHub) and *authentication*
 * (signing in with GitHub). When an **already signed-in** user links GitHub from
 * Connected Services, authentik takes the LINK path
 * (`SourceFlowManager.handle_existing_link`): it saves the connection and
 * redirects, with no flow and therefore no property mappings. Anyone who signs in
 * with a password and links GitHub afterwards never gets the attribute written, so
 * this endpoint fills it in on demand.
 *
 * All the connection carries is `identifier` — GitHub's numeric user id — so we
 * resolve that to the current username via GitHub's public API and write it with
 * the admin token (the browser can't: attributes aren't writable, or even visible,
 * through /core/users/me/).
 *
 * We never trust anything from the browser: the caller is resolved from their
 * authentik session cookie, and the connection is read back with that same cookie
 * (owner-scoped), so this can only ever touch the caller's own account.
 *
 * ── `attributes.github.login_disabled` ─────────────────────────────────────────
 * Also written here: a per-user opt-out of *signing in* with GitHub while staying
 * linked (a company-owned GitHub account someone wants shown on their profile but
 * not treated as a credential). Nothing in this app enforces it — the flag is only
 * meaningful because authentik checks it. **The enforcing policy lives in
 * authentik, not here**: an expression policy bound to a Deny stage on the source
 * authentication flow (`ietf-social-callback`), ordered before its user-login
 * stage, with `evaluate_on_plan: true`:
 *
 *     source = request.context.get("source")
 *     if not source or "github" not in source.slug.lower():
 *         return False
 *     user = request.context.get("pending_user")
 *     if not user or not user.pk:
 *         return False
 *     return bool((user.attributes.get("github") or {}).get("login_disabled"))
 *
 * True pulls the Deny stage into the plan and the flow fails (FlowExecutor renders
 * `ak-stage-access-denied`, so the deny_message is what the user sees); False skips
 * it and sign-in proceeds. The source slug check is needed because that flow is
 * shared by all three sources. Deny stage rather than a flow-root policy binding
 * on purpose: a root denial raises FlowNonApplicableException, which surfaces as a
 * generic authentik error we don't control.
 *
 * Linking is unaffected by that policy without any special-casing, because the
 * LINK path runs no flow at all (see above) — which is exactly what this feature
 * needs. Enrollment needs no handling either: no account yet means no attribute.
 */

/**
 * A source connection row from /sources/user_connections/all/, as far as we read
 * it. `identifier` is GitHub's numeric user id; `source_obj` is the expanded
 * source the /all/ endpoint embeds.
 */
interface SourceConnection {
  user?: string | number | null
  identifier?: string
  source_obj?: { slug?: string; name?: string }
}

/** The /login-disabled body: whether to keep treating the link as a credential. */
interface LoginDisabledBody {
  disabled?: unknown
}

export default async function githubRoutes(app: FastifyInstance) {
  // Where the resolved account lands on the authentik user. Matches the shape the
  // GitHub source property mapping writes, so both paths converge on one place.
  const ATTRIBUTE_KEY = 'github'

  // Resolve the acting user from their authentik session cookie, or reply 401.
  async function requireCaller(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<AuthentikUser | null> {
    let user: AuthentikUser | null = null
    try {
      user = await resolveSessionUser(request.headers.cookie, clientFromRequest(request))
    } catch (err) {
      if (err instanceof AuthentikError) {
        reply.code(err.status ?? 502).send({ error: err.message })
        return null
      }
      throw err
    }
    if (!user) {
      reply.unauthorized('You must be signed in to update your connected services')
      return null
    }
    return user
  }

  // The caller's GitHub source connection, read with their own cookie so it's
  // owner-scoped exactly as the Connected Services page sees it. Null if they
  // haven't linked GitHub.
  async function githubConnection(
    cookieHeader: string | undefined,
    user: AuthentikUser,
    client: ClientIdentity
  ): Promise<SourceConnection | null> {
    const body = await userApiGet(
      cookieHeader,
      `/sources/user_connections/all/?page_size=100${
        user.pk != null ? `&user=${encodeURIComponent(user.pk)}` : ''
      }`,
      client
    )
    // Guard by pk client-side in case a superuser caller sees others' rows.
    const mine: SourceConnection[] = (body?.results ?? []).filter((conn: SourceConnection) => {
      return conn.user == null || user.pk == null || String(conn.user) === String(user.pk)
    })
    // The /all/ endpoint embeds the expanded source as `source_obj`. Instance slugs
    // vary ("github-enterprise"), so match on slug or name — same rule as the SPA.
    return (
      mine.find((conn) => {
        const source = conn.source_obj ?? {}
        return `${source.slug ?? ''} ${source.name ?? ''}`.toLowerCase().includes('github')
      }) ?? null
    )
  }

  // What we currently have on file. The page uses this to show the stored username
  // next to the GitHub row (attributes never reach the browser otherwise).
  app.get('/', async (request, reply) => {
    const user = await requireCaller(request, reply)
    if (!user) {
      return
    }
    const client = clientFromRequest(request)
    try {
      const [connection, full] = await Promise.all([
        githubConnection(request.headers.cookie, user, client),
        getUser(user.pk, client)
      ])
      const stored = plainObject(full.attributes?.[ATTRIBUTE_KEY])
      return {
        connected: Boolean(connection),
        username: stored.username ?? null,
        id: stored.id ?? connection?.identifier ?? null,
        loginDisabled: Boolean(stored.login_disabled)
      }
    } catch (err) {
      if (err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
  })

  // Resolve the linked account's numeric id to its current username and store it.
  // Idempotent: safe to click again, and it picks up a GitHub username change.
  app.post('/refresh', async (request, reply) => {
    const user = await requireCaller(request, reply)
    if (!user) {
      return
    }
    const client = clientFromRequest(request)
    try {
      const connection = await githubConnection(request.headers.cookie, user, client)
      if (!connection) {
        return reply.badRequest('Connect your GitHub account first.')
      }

      const github = await fetchGithubUserById(connection.identifier)

      // authentik REPLACES `attributes` wholesale on PATCH (it's a JSON field, not
      // deep-merged), so read the full object and merge — see patchUser's note.
      const full = await getUser(user.pk, client)
      const attributes = {
        ...full.attributes,
        [ATTRIBUTE_KEY]: {
          ...plainObject(full.attributes?.[ATTRIBUTE_KEY]),
          username: github.login,
          id: github.id,
          profile_url: github.profileUrl
        }
      }
      await patchUser(user.pk, { attributes }, client)

      request.log.info({ pk: user.pk, login: github.login }, 'github: username refreshed')
      return { username: github.login, id: github.id, profileUrl: github.profileUrl }
    } catch (err) {
      if (err instanceof GithubError || err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
  })

  // Turn "Sign in with GitHub" off (or back on) for the caller, leaving the link
  // itself in place. Only sets the flag — the authentik policy documented at the
  // top of this file is what actually refuses the sign-in.
  app.post<{ Body: LoginDisabledBody }>('/login-disabled', async (request, reply) => {
    const user = await requireCaller(request, reply)
    if (!user) {
      return
    }
    const disabled = request.body?.disabled
    if (typeof disabled !== 'boolean') {
      return reply.badRequest('`disabled` must be true or false.')
    }
    const client = clientFromRequest(request)
    try {
      const connection = await githubConnection(request.headers.cookie, user, client)
      if (!connection) {
        return reply.badRequest('Connect your GitHub account first.')
      }

      // authentik REPLACES `attributes` wholesale on PATCH — read the full object
      // and merge, exactly as /refresh does.
      const full = await getUser(user.pk, client)
      const github = { ...plainObject(full.attributes?.[ATTRIBUTE_KEY]) }
      if (disabled) {
        github.login_disabled = true
      } else {
        // Clear rather than store `false`, so the attribute stays clean and the
        // policy's falsy check is the only thing that matters.
        delete github.login_disabled
      }
      const attributes = { ...full.attributes, [ATTRIBUTE_KEY]: github }
      await patchUser(user.pk, { attributes }, client)

      request.log.info({ pk: user.pk, disabled }, 'github: sign-in availability changed')
      return { loginDisabled: disabled }
    } catch (err) {
      if (err instanceof AuthentikError) {
        return reply.code(err.status ?? 502).send({ error: err.message })
      }
      throw err
    }
  })
}
