import { config } from '../lib/config.js'
import {
  beginFlow,
  advanceFlow,
  isFlowComplete,
  getCurrentUser,
  logout,
  AuthentikError
} from '../lib/authentik.js'

// Map the public "kind" the frontend asks for to a configured authentik flow.
const FLOW_SLUGS = {
  authentication: config.authentik.flows.authentication,
  enrollment: config.authentik.flows.enrollment,
  recovery: config.authentik.flows.recovery
}

/**
 * Thin, generic bridge over the authentik Flow Executor.
 *
 * The frontend never talks to authentik directly — it asks us to `begin` a
 * flow, renders whatever challenge we hand back, collects the user's input,
 * and `submit`s it. We replay the flow's cookie jar (kept in the session) so
 * authentik advances its state machine, and when the flow completes we resolve
 * the logged-in user and stash them in the session.
 */
export default async function authRoutes(app) {
  function serialize(challenge, session) {
    const complete = isFlowComplete(challenge)
    return {
      complete,
      // Don't leak the redirect target to the SPA; it's meaningless headless.
      challenge: complete ? { component: challenge.component } : withSources(challenge),
      user: session.user ?? null
    }
  }

  // Shape an authentik user object into the trimmed record we keep in session.
  function toSessionUser(user) {
    return {
      pk: user.pk,
      uid: user.uid,
      username: user.username,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      isActive: user.is_active,
      groups: user.groups_obj?.map((g) => g.name) ?? []
    }
  }

  async function finalize(kind, session) {
    // Flow reached xak-flow-redirect => the user is authenticated in authentik.
    const jar = session.flow.jar
    session.user = toSessionUser(await getCurrentUser(jar))
    // Keep the authenticated jar so we can invalidate it on logout.
    session.akSession = jar
    session.flow = null
    return session.user
  }

  app.post('/flow/:kind/begin', async (request, reply) => {
    const { kind } = request.params
    const slug = FLOW_SLUGS[kind]
    if (!slug) return reply.badRequest(`Unknown flow "${kind}"`)

    try {
      const { challenge, jar } = await beginFlow(slug)
      request.session.flow = { kind, slug, jar }
      if (isFlowComplete(challenge)) await finalize(kind, request.session)
      return serialize(challenge, request.session)
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.post('/flow/:kind/submit', async (request, reply) => {
    const { kind } = request.params
    const flow = request.session.flow
    if (!flow || flow.kind !== kind) {
      return reply.conflict('No flow in progress — call begin first')
    }

    try {
      const { challenge, jar } = await advanceFlow(flow.slug, flow.jar, request.body ?? {})
      request.session.flow.jar = jar
      if (isFlowComplete(challenge)) await finalize(kind, request.session)
      return serialize(challenge, request.session)
    } catch (err) {
      return handleError(err, reply)
    }
  })

  // Complete a social / source login round-trip.
  //
  // Unlike password flows, an OAuth source login can't be driven headlessly:
  // the browser itself is redirected out to authentik (and on to the provider)
  // and back. authentik authenticates the user and sets *its own* session cookie
  // in the browser. Because this app is deployed on the same host as authentik,
  // that cookie is sent here too — so we rebuild a jar from the incoming
  // authentik cookies and resolve who just signed in, exactly as a completed
  // flow would. See the social buttons in FlowExecutor.vue for the outbound leg.
  app.post('/social/finalize', async (request, reply) => {
    const jar = {}
    for (const [name, value] of Object.entries(request.cookies ?? {})) {
      if (name.startsWith('authentik_')) jar[name] = value
    }
    if (!Object.keys(jar).length) {
      return reply.unauthorized('No authentik session — social login did not complete')
    }
    try {
      const user = await getCurrentUser(jar)
      // An unauthenticated authentik session resolves to the anonymous user.
      if (!user?.pk || user.username === 'AnonymousUser') {
        return reply.unauthorized('Social login did not complete')
      }
      request.session.user = toSessionUser(user)
      request.session.akSession = jar
      request.session.flow = null
      return { user: request.session.user }
    } catch (err) {
      return handleError(err, reply)
    }
  })

  // Current session — the SPA calls this on boot to know if a user is signed in.
  app.get('/session', async (request) => ({ user: request.session.user ?? null }))

  app.post('/logout', async (request, reply) => {
    if (request.session.akSession) {
      await logout(request.session.akSession)
    }
    await request.session.destroy()
    reply.clearCookie('sessionId', { path: '/' })
    return { ok: true }
  })
}

// Resolve an authentik-relative URL (e.g. "/source/oauth/login/google/",
// "/static/…svg") into an absolute one the browser can navigate to. Values that
// are already absolute are returned untouched.
function absolutize(url) {
  if (!url) return url
  return /^https?:\/\//i.test(url) ? url : `${config.authentik.url}/${url.replace(/^\/+/, '')}`
}

// Enrich the identification challenge's `sources` (the configured social /
// federated login sources) with ready-to-use absolute URLs. Each source becomes
// `{ name, icon_url, url }`, where `url` is the flow-independent endpoint the
// browser hits to start that source's OAuth round-trip. Non-source challenges
// pass through unchanged.
function withSources(challenge) {
  if (!challenge?.sources?.length) return challenge
  return {
    ...challenge,
    sources: challenge.sources.map((s) => ({
      name: s.name,
      icon_url: absolutize(s.icon_url),
      url: absolutize(typeof s.challenge === 'string' ? s.challenge : s.challenge?.to)
    }))
  }
}

function handleError(err, reply) {
  if (err instanceof AuthentikError) {
    return reply.code(err.status >= 400 && err.status < 600 ? err.status : 502).send({
      error: err.message,
      detail: err.detail
    })
  }
  throw err
}
