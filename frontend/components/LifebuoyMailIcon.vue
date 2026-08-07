<script setup>
// heroicons' "lifebuoy" with an envelope badged into its bottom-right quarter —
// the Recovery Emails glyph (sidebar nav + that section's empty state).
//
// Unlike every other icon here it can't be a single `d` string, because the buoy
// fills the whole 24x24 grid: without cutting it away the envelope lands on top of
// two spokes and an arc and the shapes read as tangled rather than layered. The
// cut is a mask rather than a halo stroked in the background colour, because there
// is no single background to knock out — this renders on white, on slate-50/100
// (nav hover) and on sky-600 (the active nav item).
defineProps({
  // Matches the surrounding icon set: 1.5 in the nav, lighter for large empty-state
  // sizes (see pages/account/recovery-emails.vue).
  strokeWidth: { type: [Number, String], default: 1.5 }
})

// Unique per instance: the sidebar and the empty state render this at the same
// time on the Recovery Emails page, and two identical DOM ids would collide.
const maskId = useId()

const BUOY =
  'M16.712 4.33a9.027 9.027 0 011.652 1.306c.51.51.944 1.064 1.306 1.652M16.712 4.33l-3.448 4.138m3.448-4.138a9.014 9.014 0 00-9.424 0M19.67 7.288l-4.138 3.448m4.138-3.448a9.014 9.014 0 010 9.424m-4.138-5.976a3.736 3.736 0 00-.88-1.388 3.737 3.737 0 00-1.388-.88m2.268 2.268a3.765 3.765 0 010 2.528m-2.268-4.796a3.765 3.765 0 00-2.528 0m4.796 4.796c-.181.506-.475.982-.88 1.388a3.736 3.736 0 01-1.388.88m2.268-2.268l4.138 3.448m0 0a9.027 9.027 0 01-1.306 1.652c-.51.51-1.064.944-1.652 1.306m0 0l-3.448-4.138m3.448 4.138a9.014 9.014 0 01-9.424 0m5.976-4.138a3.765 3.765 0 01-2.528 0m0 0a3.736 3.736 0 01-1.388-.88 3.737 3.737 0 01-.88-1.388m2.268 2.268L7.288 19.67m0 0a9.024 9.024 0 01-1.652-1.306 9.027 9.027 0 01-1.306-1.652m0 0l4.138-3.448M4.33 16.712a9.014 9.014 0 010-9.424m4.138 5.976a3.765 3.765 0 010-2.528m0 0c.181-.506.475-.982.88-1.388a3.736 3.736 0 011.388-.88m-2.268 2.268L4.33 7.288m6.406 1.18L7.288 4.33m0 0a9.024 9.024 0 00-1.652 1.306A9.025 9.025 0 004.33 7.288'

// The envelope's outline, reused as the mask's silhouette (filled, then fattened
// by a wide stroke) so the gap around it follows the same shape.
const ENVELOPE_BODY =
  'M14.5 14.75h6.75a1.5 1.5 0 011.5 1.5v4a1.5 1.5 0 01-1.5 1.5h-6.75a1.5 1.5 0 01-1.5-1.5V16.25a1.5 1.5 0 011.5-1.5z'
const ENVELOPE = `${ENVELOPE_BODY}M13.4 15.5l3.7 2.66a1.3 1.3 0 001.56 0l3.7-2.66`
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <!-- White keeps, black removes: the buoy survives everywhere except under the
         envelope and a stroke's width around it. -->
    <mask :id="maskId" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
      <rect width="24" height="24" fill="#fff" stroke="none" />
      <path :d="ENVELOPE_BODY" fill="#000" stroke="#000" stroke-width="2.4" />
    </mask>
    <path :d="BUOY" :mask="`url(#${maskId})`" />
    <path :d="ENVELOPE" />
  </svg>
</template>
