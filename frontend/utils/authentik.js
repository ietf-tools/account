// Pure helpers for talking to authentik directly from the browser. These moved
// out of the backend when the SPA started driving flows itself; the source-URL
// logic mirrors what routes/auth.js used to do server-side.

// A flow is finished (and successful) when it hands back a redirect.
export function isFlowComplete(challenge) {
  return challenge?.component === 'xak-flow-redirect'
}

// authentik's browser flow views (e.g. the flow-cancel endpoint that discards the
// current plan) live under /flows/ at the authentik root — a sibling of the
// /api/v3 API base, NOT under it. Derive that base from the configured API URL so
// a same-origin ("/api/v3") or an absolute ("https://auth.example.com/api/v3")
// override both resolve correctly.
export function flowsCancelUrl(authentikApiUrl) {
  const base = authentikApiUrl.replace(/\/+$/, '').replace(/\/api\/v3$/, '')
  return `${base}/flows/-/cancel/`
}

// authentik's identification challenge hands us browser-facing flow URLs
// (passwordless_url, enroll_url, recovery_url) shaped like /if/flow/<slug>/…. To
// drive one ourselves via the executor we only need its slug.
export function flowSlugFromUrl(url) {
  return url?.match(/\/if\/flow\/([^/?#]+)/)?.[1] ?? null
}

// authentik resolves an unauthenticated session to this pseudo-user.
export function isAnonymous(user) {
  return !user?.pk || user.username === 'AnonymousUser'
}

// Shape an authentik user object into the trimmed record we keep in the store.
export function toSessionUser(user) {
  return {
    pk: user.pk,
    uid: user.uid,
    username: user.username,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    isActive: user.is_active,
    // authentik grants admin-interface access to superusers; /core/users/me/
    // reports it as is_superuser on the self serializer.
    isSuperuser: Boolean(user.is_superuser),
    // The admin UserSerializer expands groups under `groups_obj` (with `groups`
    // being bare UUIDs); the self serializer (/core/users/me/, what we actually
    // use) puts the expanded objects on `groups` and has no `groups_obj`. Accept
    // either, and either objects ({name}) or bare strings.
    groups: (user.groups_obj ?? user.groups ?? [])
      .map((group) => (typeof group === 'string' ? group : group?.name))
      .filter(Boolean)
  }
}

// Resolve an authentik-relative URL ("/source/oauth/login/google/", "/static/…")
// into an absolute one the browser can navigate to. Same-origin in production, so
// window.location.origin is authentik's origin; already-absolute values pass
// through untouched.
function absolutize(url) {
  if (!url) {
    return url
  }
  if (/^https?:\/\//i.test(url)) {
    return url
  }
  return `${window.location.origin}/${url.replace(/^\/+/, '')}`
}

// Resolve the browser-facing login URL for a single source's challenge.
//
// Most OAuth/SAML sources (Google, GitHub, …) present as a redirect challenge: a
// plain `to` pointing at /source/oauth/login/<slug>/. "Sign in with Apple" is the
// exception — authentik hands back a dedicated ak-source-oauth-apple challenge
// carrying Apple JS-SDK params and *no* `to`. We do a full-page redirect rather
// than use that SDK, so we fall back to authentik's generic server-side login
// endpoint, deriving the source slug from the callback redirect_uri.
function sourceUrl(challenge) {
  if (!challenge) {
    return undefined
  }
  if (typeof challenge === 'string') {
    return challenge
  }
  if (challenge.to) {
    return challenge.to
  }
  const slug = challenge.redirect_uri?.match(/\/source\/oauth\/callback\/([^/]+)\/?/)?.[1]
  if (slug) {
    return `/source/oauth/login/${slug}/`
  }
  return undefined
}

// Enrich an identification challenge's `sources` with ready-to-use absolute URLs.
// Each source becomes `{ name, icon_url, url }`, where `url` is the endpoint the
// browser hits to start that source's OAuth round-trip. Non-source challenges
// pass through unchanged. A source we can't resolve is logged (dev) and rendered
// as a disabled button rather than failing silently.
export function withSources(challenge) {
  if (!challenge?.sources?.length) {
    return challenge
  }
  return {
    ...challenge,
    sources: challenge.sources.map((s) => {
      const url = absolutize(sourceUrl(s.challenge))
      if (!url && import.meta.dev) {
        console.warn(
          `social login source "${s.name}" has no resolvable URL — add its challenge shape to sourceUrl()`,
          s.challenge
        )
      }
      return {
        name: s.name,
        icon_url: absolutize(s.icon_url),
        url
      }
    })
  }
}
