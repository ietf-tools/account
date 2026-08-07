// Advisory password-strength scoring for the meter under the new-password field.
//
// This is UI feedback only — the real rules live in authentik's password policies
// on the flow, and a password this rates "strong" can still be rejected there (and
// vice versa). Kept dependency-free and small: a rough entropy estimate rather than
// a dictionary-based library.

// Character classes and how many symbols each contributes to the search space.
const POOLS = [
  [/[a-z]/, 26],
  [/[A-Z]/, 26],
  [/[0-9]/, 10],
  [/[^A-Za-z0-9]/, 33]
]

// Bits of estimated entropy we treat as the top of the meter. ~72 bits is well past
// what any of our policies ask for, so the bar fills before the limit is silly-long.
const FULL_BITS = 72

// Only the handful that turn up at the top of every breach list. Not a dictionary —
// it exists so "password1" can't ride its length and variety to a green bar.
const COMMON = [
  'password',
  'passw0rd',
  'qwerty',
  'azerty',
  'letmein',
  'welcome',
  'iloveyou',
  'admin',
  'monkey',
  'dragon',
  'abc123',
  'football',
  'baseball',
  'sunshine',
  'princess',
  'ietf'
]

// Collapse runs of the same character ("aaaa" → "a") so padding doesn't inflate the
// estimate, and count a straight run of a repeated pattern only once.
function effectiveLength(value) {
  return value.replace(/(.)\1+/g, '$1').length
}

// Ascending or descending runs of three or more ("abc", "321", "qwe" is not caught —
// keyboard walks are what the common list is for).
function hasSequence(value) {
  const lower = value.toLowerCase()
  for (let i = 0; i + 2 < lower.length; i += 1) {
    const a = lower.charCodeAt(i)
    const b = lower.charCodeAt(i + 1)
    const c = lower.charCodeAt(i + 2)
    if ((b - a === 1 && c - b === 1) || (a - b === 1 && b - c === 1)) {
      return true
    }
  }
  return false
}

// { percent, level, label } for a password. `percent` drives the bar width and grows
// smoothly with length/variety; `level` (0–3) picks the colour.
export function passwordStrength(password) {
  const value = String(password ?? '')
  if (!value) {
    return { percent: 0, level: 0, label: '' }
  }

  const pool = POOLS.reduce((total, [pattern, size]) => (pattern.test(value) ? total + size : total), 0)
  let bits = effectiveLength(value) * Math.log2(pool || 1)

  const lower = value.toLowerCase()
  if (COMMON.some((word) => lower.includes(word))) {
    bits = Math.min(bits, 20)
  }
  if (hasSequence(value)) {
    bits *= 0.75
  }

  const percent = Math.max(0, Math.min(100, Math.round((bits / FULL_BITS) * 100)))
  if (bits < 28) {
    return { percent: Math.max(percent, 6), level: 0, label: 'Weak' }
  }
  if (bits < 44) {
    return { percent, level: 1, label: 'Fair' }
  }
  if (bits < 60) {
    return { percent, level: 2, label: 'Good' }
  }
  return { percent, level: 3, label: 'Strong' }
}
