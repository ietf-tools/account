<script setup>
// Subtle IETF-flavoured backdrop: a canvas of network paths that grow along
// 45° diagonals (echoing the logo's signal line) and branch out from their
// endpoints into more diagonals, spreading across the screen like a signal
// propagating through a network. Little packet-blocks travel each segment, and
// segments fade out over their lifetime while fresh roots keep seeding. Sits
// behind all content (pointer-events-none, negative z-index) and stays idle
// under prefers-reduced-motion.
const canvas = ref(null)

// The four 45° directions, plus a helper to pick a segment's continuations:
// carry straight on, or turn 90° (flip one axis) — never fold straight back.
const DIRS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1]
]
const MAX_GEN = 9
const MAX_SEGMENTS = 55
const MARGIN = 16
// While a connection is being "negotiated" its line is dashed and the dashes
// march forward; the pattern below sets the dash/gap size, the marching speed
// (px/ms), and how long the final merge-to-solid takes.
const DASH = 5
const DASH_GAP = 6
const DASH_SPEED = 0.03
const MERGE_MS = 900

let ctx = null
let raf = 0
let running = false
let desktopMq = null
let reduceMq = null
let nodes = []
let segments = []
let width = 0
let height = 0
// Junction nodes persist across frames so they can ease in/out (each keeps an
// `intensity` 0→1 driving its size and opacity) instead of popping.
let junctionNodes = new Map()
let lastFrame = 0

function rand(min, max) {
  return min + Math.random() * (max - min)
}

// Lay root anchors on a jittered grid — one per cell — so they cover the
// viewport evenly instead of clumping the way pure-random placement does.
function seedNodes() {
  nodes = []
  const target = Math.min(30, Math.max(10, Math.round((width * height) / 45000)))
  const cols = Math.max(1, Math.round(Math.sqrt((target * width) / height)))
  const rows = Math.max(1, Math.round(target / cols))
  const cellW = width / cols
  const cellH = height / rows
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Jitter within the cell (keep off the very edges) to avoid a rigid look.
      nodes.push({
        x: (c + 0.15 + Math.random() * 0.7) * cellW,
        y: (r + 0.15 + Math.random() * 0.7) * cellH
      })
    }
  }
}

function inBounds(pt) {
  return pt.x >= MARGIN && pt.x <= width - MARGIN && pt.y >= MARGIN && pt.y <= height - MARGIN
}

// Soft "keep-out" zone over the centre, where the card sits. Not a hard rule —
// endpoints/roots merely prefer to land outside it, so the middle stays sparse
// without being empty.
function inCenter(pt) {
  const rx = Math.min(340, width * 0.3)
  const ry = Math.min(320, height * 0.34)
  const nx = (pt.x - width / 2) / rx
  const ny = (pt.y - height / 2) / ry
  return nx * nx + ny * ny < 1
}

// Add one diagonal segment starting at `a` heading in `dir`. Picks a length
// that keeps the far end on-screen and prefers to avoid the centre; returns
// null (path ends) if nothing fits on-screen.
function addSegment(a, dir, gen, now) {
  let b = null
  let length = 0
  let fallback = null
  for (let attempt = 0; attempt < 6; attempt++) {
    const candLen = rand(120, 340)
    const cand = { x: a.x + dir[0] * candLen, y: a.y + dir[1] * candLen }
    if (!inBounds(cand)) {
      continue
    }
    if (!fallback) {
      fallback = { pt: cand, len: candLen }
    }
    if (!inCenter(cand)) {
      b = cand
      length = candLen
      break
    }
  }
  if (!b && fallback) {
    // Every on-screen option was central — take it anyway rather than stall.
    b = fallback.pt
    length = fallback.len
  }
  if (!b) {
    return null
  }
  const seg = {
    a,
    b,
    dir,
    gen,
    born: now,
    // Speed is roughly constant, so longer segments take longer to draw.
    drawDur: length * rand(2.4, 3.4),
    // "Negotiation" window after the line finishes drawing: it stays dashed
    // (with the dashes marching forward) for this long, then the gaps close up
    // and it becomes a solid, "established" connection.
    settleDur: rand(1000, 3000),
    life: rand(9000, 16000),
    fadeOut: 2200,
    branched: false,
    // Pause after finishing before sprouting, so the network spreads gradually.
    branchDelay: rand(900, 2200),
    packets: [],
    nextPacket: now + rand(300, 900)
  }
  segments.push(seg)
  return seg
}

// Start a brand-new path, choosing the emptiest of several candidate anchors so
// roots fill sparse regions rather than piling into already-busy ones (and
// preferring anchors away from the centre).
function spawnRoot(now) {
  if (nodes.length === 0) {
    return
  }
  const points = []
  for (const s of segments) {
    points.push(s.a, s.b)
  }
  const radius = Math.min(width, height) * 0.28
  const r2 = radius * radius
  let best = null
  let bestScore = Infinity
  for (let attempt = 0; attempt < 6; attempt++) {
    const cand = nodes[Math.floor(Math.random() * nodes.length)]
    // Nearby segment endpoints = how crowded this anchor already is.
    let score = 0
    for (const pt of points) {
      const dx = pt.x - cand.x
      const dy = pt.y - cand.y
      if (dx * dx + dy * dy < r2) {
        score++
      }
    }
    if (inCenter(cand)) {
      score += 100
    }
    if (score < bestScore) {
      bestScore = score
      best = cand
    }
  }
  const start = { x: best.x, y: best.y }
  addSegment(start, DIRS[Math.floor(Math.random() * DIRS.length)], 0, now)
}

// Sprout a new diagonal from an existing point somewhere in the network (a
// random fully-drawn segment's endpoint), rather than only from the newest
// tip — so established junctions can spawn fresh branches too.
function spawnFromExisting(now) {
  if (segments.length >= MAX_SEGMENTS) {
    return
  }
  const drawn = segments.filter((s) => {
    return now - s.born >= s.drawDur && s.gen < MAX_GEN
  })
  if (drawn.length === 0) {
    return
  }
  const seg = drawn[Math.floor(Math.random() * drawn.length)]
  const useB = Math.random() < 0.5
  const point = useB ? seg.b : seg.a
  // Head away from the existing line: straight on or a 90° turn, no reversal.
  const base = useB ? seg.dir : [-seg.dir[0], -seg.dir[1]]
  const options = [
    [base[0], base[1]],
    [base[0], -base[1]],
    [-base[0], base[1]]
  ]
  const dir = options[Math.floor(Math.random() * options.length)]
  addSegment({ x: point.x, y: point.y }, dir, seg.gen + 1, now)
}

// When a segment finishes drawing, sprout its continuations from the endpoint.
function branch(seg, now) {
  seg.branched = true
  if (seg.gen >= MAX_GEN || segments.length >= MAX_SEGMENTS) {
    return
  }
  const [dx, dy] = seg.dir
  // Straight on, or a 90° turn either way — never a reversal.
  const options = [
    [dx, dy],
    [dx, -dy],
    [-dx, dy]
  ]
  const r = Math.random()
  const count = r < 0.15 ? 0 : r < 0.7 ? 1 : 2
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = options[i]
    options[i] = options[j]
    options[j] = tmp
  }
  for (let i = 0; i < count; i++) {
    addSegment({ x: seg.b.x, y: seg.b.y }, options[i], seg.gen + 1, now)
  }
}

function frame(now) {
  if (!running) {
    return
  }
  raf = requestAnimationFrame(frame)
  ctx.clearRect(0, 0, width, height)

  // The backdrop uses the dark palette (the page background is dark; only the
  // card is light).
  const rgb = '56,189,248'
  const maxLine = 0.14

  // Keep the field populated: seed a little when sparse, rarely otherwise.
  const seedChance = segments.length < 3 ? 0.05 : 0.006
  if (segments.length < MAX_SEGMENTS && Math.random() < seedChance) {
    spawnRoot(now)
  }
  // Occasionally sprout a branch from an existing point in the network.
  if (Math.random() < 0.02) {
    spawnFromExisting(now)
  }

  // Tally how many line-ends meet at each point (coincident endpoints share
  // coordinates), so we can mark real junctions as nodes after drawing.
  const junctions = new Map()
  function tally(x, y) {
    const key = `${Math.round(x)},${Math.round(y)}`
    const j = junctions.get(key)
    if (j) {
      j.count++
    } else {
      junctions.set(key, { x, y, count: 1 })
    }
  }

  for (let i = segments.length - 1; i >= 0; i--) {
    const l = segments[i]
    const age = now - l.born
    if (age > l.life) {
      segments.splice(i, 1)
      continue
    }

    // Alpha lifecycle: ramp up while drawing, hold, then fade out at the end.
    const remaining = l.life - age
    let alpha = maxLine
    if (age < l.drawDur) {
      alpha = maxLine * (age / l.drawDur)
    } else if (remaining < l.fadeOut) {
      alpha = maxLine * (remaining / l.fadeOut)
    }

    // Draw progress: the line grows from a → b over drawDur.
    const p = Math.min(1, age / l.drawDur)
    const ex = l.a.x + (l.b.x - l.a.x) * p
    const ey = l.a.y + (l.b.y - l.a.y) * p

    // Dashed while the connection negotiates, then the gap eases to zero so the
    // line resolves into a solid, "established" link. `negotiateEnd` is the end
    // of drawing plus the settle window.
    const negotiateEnd = l.drawDur + l.settleDur
    if (age < negotiateEnd) {
      let gap = DASH_GAP
      const mergeStart = negotiateEnd - MERGE_MS
      if (age > mergeStart) {
        gap = DASH_GAP * (1 - (age - mergeStart) / MERGE_MS)
      }
      ctx.setLineDash([DASH, gap])
      // Negative offset marches the dashes forward, from a → b.
      ctx.lineDashOffset = -(now * DASH_SPEED) % (DASH + DASH_GAP)
    }

    ctx.strokeStyle = `rgba(${rgb},${alpha})`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(l.a.x, l.a.y)
    ctx.lineTo(ex, ey)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.fillStyle = `rgba(${rgb},${alpha * 1.7})`
    for (const pt of [l.a, l.b]) {
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, 1.6, 0, Math.PI * 2)
      ctx.fill()
    }

    // A line always emanates from `a`; it reaches `b` once fully drawn.
    tally(l.a.x, l.a.y)
    if (p >= 1) {
      tally(l.b.x, l.b.y)
    }

    // Once fully drawn: branch out (once), then run packets until it fades.
    if (p >= 1) {
      if (!l.branched && age >= l.drawDur + l.branchDelay) {
        branch(l, now)
      }
      if (age >= negotiateEnd && remaining > l.fadeOut && now >= l.nextPacket) {
        // Traffic flows both ways, in a mix of sizes; mostly blue with the
        // occasional IETF-logo yellow packet (#fdd34f).
        l.packets.push({
          start: now,
          dur: rand(1400, 2600),
          reverse: Math.random() < 0.5,
          size: Math.random() < 0.5 ? 4 : 2.5,
          color: Math.random() < 0.1 ? '253,211,79' : '56,189,248'
        })
        l.nextPacket = now + rand(700, 1600)
      }
    }
    for (let j = l.packets.length - 1; j >= 0; j--) {
      const pk = l.packets[j]
      const pp = (now - pk.start) / pk.dur
      if (pp >= 1) {
        l.packets.splice(j, 1)
        continue
      }
      const t = pk.reverse ? 1 - pp : pp
      const px = l.a.x + (l.b.x - l.a.x) * t
      const py = l.a.y + (l.b.y - l.a.y) * t
      const pa = (alpha / maxLine) * 0.6
      ctx.fillStyle = `rgba(${pk.color},${pa})`
      const s = pk.size
      ctx.fillRect(px - s / 2, py - s / 2, s, s)
    }
  }

  // Junctions where more than two lines meet are drawn as a pulsing diamond
  // (a 45°-rotated square outline) — an internet node bridging networks.
  // Sync the current active junctions into the persistent node set.
  for (const node of junctionNodes.values()) {
    node.active = false
  }
  for (const [key, j] of junctions) {
    if (j.count <= 2) {
      continue
    }
    const existing = junctionNodes.get(key)
    if (existing) {
      existing.active = true
      existing.x = j.x
      existing.y = j.y
    } else {
      // Random phase offset so nodes don't all ripple in lockstep.
      junctionNodes.set(key, { x: j.x, y: j.y, intensity: 0, active: true, offset: Math.random() })
    }
  }

  // Ease each node toward its target (present → 1, gone → 0), then draw. Framerate
  // -independent smoothing so the grow/fade reads the same at any refresh rate.
  const dt = lastFrame ? Math.min(50, now - lastFrame) : 16
  lastFrame = now
  const ease = 1 - Math.exp(-dt / 180)
  const peakAlpha = Math.min(0.5, maxLine * 2)
  const RIPPLES = 3
  const RIPPLE_MS = 3200
  ctx.lineWidth = 1.3
  for (const [key, node] of junctionNodes) {
    node.intensity += ((node.active ? 1 : 0) - node.intensity) * ease
    if (!node.active && node.intensity < 0.02) {
      junctionNodes.delete(key)
      continue
    }
    ctx.save()
    ctx.translate(node.x, node.y)
    ctx.rotate(Math.PI / 4)
    // Emanating waves: several diamonds at staggered phases, each growing and
    // fading as it expands, so a fresh small one always follows the last.
    for (let k = 0; k < RIPPLES; k++) {
      const phase = ((now / RIPPLE_MS) + node.offset + k / RIPPLES) % 1
      const size = 5 + phase * 22
      const alpha = peakAlpha * (1 - phase) * node.intensity
      ctx.strokeStyle = `rgba(${rgb},${alpha})`
      ctx.strokeRect(-size / 2, -size / 2, size, size)
    }
    ctx.restore()
  }
}

function resize() {
  const dpr = window.devicePixelRatio || 1
  width = window.innerWidth
  height = window.innerHeight
  canvas.value.width = width * dpr
  canvas.value.height = height * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  seedNodes()
  segments = []
  junctionNodes.clear()
}

// Only animate on tablet-and-up (Tailwind's md = 768px) and when motion is
// allowed; phones stay static. Re-evaluated live on viewport/orientation and
// media-query changes so it starts/stops when crossing the breakpoint.
function shouldAnimate() {
  return desktopMq.matches && !reduceMq.matches
}

function evaluate() {
  if (shouldAnimate() && !running) {
    running = true
    lastFrame = 0
    raf = requestAnimationFrame(frame)
  } else if (!shouldAnimate() && running) {
    running = false
    cancelAnimationFrame(raf)
    ctx.clearRect(0, 0, width, height)
  }
}

onMounted(() => {
  ctx = canvas.value.getContext('2d')
  resize()
  desktopMq = window.matchMedia('(min-width: 768px)')
  reduceMq = window.matchMedia('(prefers-reduced-motion: reduce)')
  window.addEventListener('resize', resize)
  desktopMq.addEventListener('change', evaluate)
  reduceMq.addEventListener('change', evaluate)
  evaluate()
})

onBeforeUnmount(() => {
  running = false
  cancelAnimationFrame(raf)
  window.removeEventListener('resize', resize)
  desktopMq?.removeEventListener('change', evaluate)
  reduceMq?.removeEventListener('change', evaluate)
})
</script>

<template>
  <canvas ref="canvas" class="pointer-events-none fixed inset-0 -z-20 h-full w-full" aria-hidden="true" />
</template>
