import { config } from './config.js'

/**
 * Minimal GitHub REST client — resolves a GitHub **numeric user id** to that
 * account's current login (username) and profile URL.
 *
 * The numeric id is all authentik keeps for a linked GitHub account: the OAuth
 * source connection's `identifier` comes from the GitHub source's `get_user_id`,
 * i.e. `info["id"]`. See [routes/github.js](../routes/github.js) for why we have
 * to resolve it ourselves.
 *
 * Unauthenticated calls to api.github.com are rate limited to 60/hour **per IP** —
 * and the IP here is the app server's, shared by every user — so set
 * `GITHUB_API_TOKEN` (any classic PAT, no scopes needed: `/user/{id}` is public
 * data) to get 5000/hour.
 */

const API = 'https://api.github.com'

export class GithubError extends Error {
  constructor(message, status = 502, detail = null) {
    super(message)
    this.name = 'GithubError'
    this.status = status
    this.detail = detail
  }
}

// Look up a GitHub account by its numeric id. Returns { login, id, profileUrl }.
export async function fetchGithubUserById(id) {
  const numericId = String(id ?? '').trim()
  // authentik's identifier is always numeric for GitHub, but a connection made by
  // another source type (or a hand-edited one) would send us elsewhere.
  if (!/^\d+$/.test(numericId)) {
    throw new GithubError('That connection has no numeric GitHub id to look up.', 400)
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    // GitHub rejects requests without a User-Agent.
    'User-Agent': 'ietf-account-ui'
  }
  if (config.github.apiToken) {
    headers.Authorization = `Bearer ${config.github.apiToken}`
  }

  let response = null
  try {
    response = await fetch(`${API}/user/${numericId}`, { headers })
  } catch (err) {
    throw new GithubError('GitHub is unreachable right now.', 502, err.message)
  }

  if (response.status === 404) {
    throw new GithubError('That GitHub account no longer exists.', 404)
  }
  // 403/429 with the rate-limit headers is the throttle; a token lifts the ceiling.
  if (response.status === 403 || response.status === 429) {
    throw new GithubError('GitHub is rate limiting us — please try again in a few minutes.', 503)
  }
  if (!response.ok) {
    throw new GithubError(`GitHub API error (HTTP ${response.status})`, 502)
  }

  let body = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  if (!body?.login) {
    throw new GithubError('GitHub returned no username for that account.', 502)
  }

  return {
    login: body.login,
    id: String(body.id ?? numericId),
    profileUrl: body.html_url || `https://github.com/${body.login}`
  }
}
