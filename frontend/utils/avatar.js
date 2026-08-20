// Client-side twin of the initials avatar the backend generates
// (backend/routes/avatar.ts — `initialsFor` / `hueFor` / `initialsSvg`). The two
// must stay in sync: this is what the Avatar tab previews *before* the user
// commits to initials mode, so any drift makes the preview lie about the result.
//
// The backend remains authoritative — it renders the SVG that's actually stored in
// object storage and recorded on the authentik user. Nothing here is ever saved,
// except in the dev fallback where there's no live session to save through.

const AVATAR_SIZE = 256

// First letter of the first and last word of the display name, falling back to the
// username, then '?'. Mirrors initialsFor() in backend/routes/avatar.ts.
export function avatarInitials(user) {
  const name = String(user?.name ?? '').trim()
  if (name) {
    const words = name.split(/\s+/)
    const first = words[0]?.[0] ?? ''
    const last = words.length > 1 ? words[words.length - 1][0] : ''
    const initials = `${first}${last}`.toUpperCase()
    if (initials) {
      return initials
    }
  }
  const username = String(user?.username ?? '').trim()
  if (username) {
    return username[0].toUpperCase()
  }
  return '?'
}

// Deterministic hue so a given user always gets the same background colour.
function avatarHue(seed) {
  let hash = 0
  for (const char of String(seed)) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360
  }
  return hash
}

// The initials come from user input and land in a document the browser parses as
// its own file, so escape them here exactly as the backend does.
function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// The same SVG the backend would generate for this user, as a data URI usable
// directly as an <img> src.
export function initialsAvatarDataUri(user) {
  const initials = avatarInitials(user)
  const hue = avatarHue(user?.email || user?.username || initials)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" ` +
    `viewBox="0 0 ${AVATAR_SIZE} ${AVATAR_SIZE}">` +
    `<rect width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" fill="hsl(${hue}, 60%, 45%)"/>` +
    `<text x="50%" y="50%" fill="#ffffff" font-size="110" font-weight="600" ` +
    `font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" ` +
    `text-anchor="middle" dominant-baseline="central">${escapeXml(initials)}</text>` +
    `</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
