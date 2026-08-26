// One distinct line-art face per AI stylist.
//
// Every bot used to draw the SAME robot glyph, so the only thing telling Lena
// from Theo from Amara in the picker, the conversation list and the chat header
// was the accent colour behind it. Thirteen bots, one silhouette. This gives
// each of them its own face, picked deterministically from their name, so the
// same stylist always wears the same one — in the roster, the thread head, the
// message avatars and the saved strip alike.
//
// The seed is the stylist NAME rather than the id: every call site already
// passes it, names are unique across the roster, and it keeps the mapping
// readable when someone is looking at a screenshot.
//
// All variants share the drawing language of the original: 40x40 box, 1.5
// stroke in currentColor (the caller sets the accent), round caps and joins.
// They differ in silhouette — head shape, antenna, eyes, mouth — so they read
// apart at 30px, not just at full size.
import type { ReactElement } from 'react';

const FACES: (() => ReactElement)[] = [
  // 0 — the original: rounded head, ball antenna, straight mouth, side bars.
  () => (
    <>
      <path d="M20 6.5v4" />
      <circle cx="20" cy="5" r="1.6" fill="currentColor" stroke="none" />
      <rect x="9.5" y="11" width="21" height="17" rx="5.5" />
      <circle cx="15.6" cy="18.4" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="24.4" cy="18.4" r="1.9" fill="currentColor" stroke="none" />
      <path d="M15.8 23.4h8.4" />
      <path d="M6.6 16.6v5.4M33.4 16.6v5.4" />
      <path d="M13.5 28v2.2a4 4 0 0 0 4 4h5a4 4 0 0 0 4-4V28" />
    </>
  ),
  // 1 — round head, twin antennae, smile.
  () => (
    <>
      <path d="M14.5 8.2l1.8 3.2M25.5 8.2l-1.8 3.2" />
      <circle cx="13.8" cy="7" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="26.2" cy="7" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="20" cy="20.5" r="9.5" />
      <circle cx="16.4" cy="18.6" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="23.6" cy="18.6" r="1.7" fill="currentColor" stroke="none" />
      <path d="M15.8 23.6a5.2 5.2 0 0 0 8.4 0" />
    </>
  ),
  // 2 — visor bot: wide slit for eyes, grid mouth, no antenna.
  () => (
    <>
      <rect x="8" y="10.5" width="24" height="19" rx="4" />
      <rect x="12" y="15" width="16" height="5.4" rx="2.7" />
      <path d="M14.5 24.5h11M18 24.5v3.2M22 24.5v3.2" />
      <path d="M8 18h-2.4M32 18h2.4" />
    </>
  ),
  // 3 — bolt antenna, square eyes, wave mouth.
  () => (
    <>
      <path d="M20 5.5l-2.6 3.4h4.2L19 12.5" />
      <rect x="9" y="12.5" width="22" height="16.5" rx="3" />
      <rect x="13.6" y="17.4" width="4" height="4" rx="1" fill="currentColor" stroke="none" />
      <rect x="22.4" y="17.4" width="4" height="4" rx="1" fill="currentColor" stroke="none" />
      <path d="M14.6 25c1.2-1.4 2.4-1.4 3.6 0s2.4 1.4 3.6 0 2.4-1.4 3.6 0" />
    </>
  ),
  // 4 — ear discs, half-moon eyes, small round mouth.
  () => (
    <>
      <path d="M20 6v3.6" />
      <rect x="10.5" y="9.6" width="19" height="18" rx="6" />
      <circle cx="7.4" cy="19" r="2.6" />
      <circle cx="32.6" cy="19" r="2.6" />
      <path d="M14 18.6a2.6 2.6 0 0 1 4.4 0M21.6 18.6a2.6 2.6 0 0 1 4.4 0" />
      <circle cx="20" cy="23.6" r="1.8" />
    </>
  ),
  // 5 — periscope antenna, X eyes, flat mouth.
  () => (
    <>
      <path d="M20 11V7.2h5.2" />
      <circle cx="26.6" cy="7.2" r="1.4" fill="currentColor" stroke="none" />
      <rect x="10" y="11" width="20" height="18" rx="4.5" />
      <path d="M14.2 16.8l3 3M17.2 16.8l-3 3M22.8 16.8l3 3M25.8 16.8l-3 3" />
      <path d="M15.4 24.6h9.2" />
    </>
  ),
  // 6 — cyclops: one big eye, dashed mouth, two stub antennae.
  () => (
    <>
      <path d="M15.6 8.4v2.6M24.4 8.4v2.6" />
      <rect x="9.6" y="11" width="20.8" height="18" rx="7" />
      <circle cx="20" cy="18.6" r="4" />
      <circle cx="20" cy="18.6" r="1.5" fill="currentColor" stroke="none" />
      <path d="M15.2 25h2.4M19 25h2.4M22.8 25h2" />
    </>
  ),
  // 7 — capsule head, flag antenna, oval eyes, teeth.
  () => (
    <>
      <path d="M20 5.6v5" />
      <path d="M20 6.2h4.6l-1.6 1.8 1.6 1.8H20" />
      <rect x="10.5" y="10.6" width="19" height="19" rx="9.5" />
      <ellipse cx="16.2" cy="18" rx="1.6" ry="2.4" fill="currentColor" stroke="none" />
      <ellipse cx="23.8" cy="18" rx="1.6" ry="2.4" fill="currentColor" stroke="none" />
      <rect x="15" y="23" width="10" height="3.6" rx="1.2" />
      <path d="M18.4 23v3.6M21.6 23v3.6" />
    </>
  ),
  // 8 — headphones, round eyes, smirk.
  () => (
    <>
      <path d="M8.6 19v-1.4a11.4 11.4 0 0 1 22.8 0V19" />
      <rect x="5.6" y="18.4" width="4" height="7" rx="2" />
      <rect x="30.4" y="18.4" width="4" height="7" rx="2" />
      <rect x="11.6" y="13.6" width="16.8" height="15" rx="4" />
      <circle cx="16.4" cy="19.4" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="23.6" cy="19.4" r="1.8" fill="currentColor" stroke="none" />
      <path d="M16.4 24.2c1.6 1.4 4 1.6 6 .4" />
    </>
  ),
  // 9 — coil antenna, triangle eyes, straight mouth.
  () => (
    <>
      <path d="M20 11V9.4M17.8 8.6c1.6-1.6 2.8-1.6 4.4 0M17 6.4c2-2 4-2 6 0" />
      <rect x="9.4" y="11.4" width="21.2" height="17.4" rx="4" />
      <path d="M16.6 16.6l2.4 4.2h-4.8zM23.4 16.6l2.4 4.2h-4.8z" fill="currentColor" stroke="none" />
      <path d="M15.6 24.8h8.8" />
      <path d="M9.4 20h-3M30.6 20h3" />
    </>
  ),
  // 10 — brow bar, pupil eyes, wide smile.
  () => (
    <>
      <path d="M20 6.4v4.2" />
      <circle cx="20" cy="5.2" r="1.4" />
      <rect x="9.6" y="10.6" width="20.8" height="18.4" rx="5" />
      <path d="M13.4 15.6h13.2" />
      <circle cx="16" cy="19.4" r="2.2" />
      <circle cx="24" cy="19.4" r="2.2" />
      <path d="M14.6 24.4a7 7 0 0 0 10.8 0" />
    </>
  ),
  // 11 — three antennae, dot-matrix eyes, zigzag mouth.
  () => (
    <>
      <path d="M14.6 8.8v2.4M20 7.4v3.8M25.4 8.8v2.4" />
      <rect x="9" y="11.2" width="22" height="17.6" rx="3.5" />
      <path d="M14.4 17.2h.02M17.4 17.2h.02M14.4 20h.02M17.4 20h.02" strokeWidth="2.6" />
      <path d="M22.6 17.2h.02M25.6 17.2h.02M22.6 20h.02M25.6 20h.02" strokeWidth="2.6" />
      <path d="M14.8 24.8l2-1.6 2 1.6 2-1.6 2 1.6 2-1.6" />
    </>
  ),
  // 12 — side vents, visor eyes, small mouth.
  () => (
    <>
      <path d="M20 6.6v4" />
      <rect x="11" y="10.6" width="18" height="18.4" rx="4.5" />
      <path d="M7.6 16.4h2.6M7.6 19.4h2.6M7.6 22.4h2.6" />
      <path d="M29.8 16.4h2.6M29.8 19.4h2.6M29.8 22.4h2.6" />
      <path d="M14.4 18.4h4M21.6 18.4h4" strokeWidth="2.8" />
      <path d="M17.8 24h4.4" />
    </>
  ),
  // 13 — halo ring, dot eyes, open mouth.
  () => (
    <>
      <ellipse cx="20" cy="7.4" rx="6" ry="2" />
      <rect x="10.6" y="11.4" width="18.8" height="17.6" rx="8" />
      <circle cx="16.2" cy="18.2" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="23.8" cy="18.2" r="1.6" fill="currentColor" stroke="none" />
      <rect x="16.4" y="22.6" width="7.2" height="4" rx="2" />
    </>
  ),
];

// Explicit assignment for the stylists that exist today, because a hash cannot
// promise what this feature is actually for. Thirteen bots over fourteen faces
// collide with near-certainty (birthday problem) — the first hash tried here
// gave seven distinct faces for thirteen bots, with Amara, Lena and Noah all
// sharing one. Naming them is one line each and guarantees the thing the
// founder asked for: no two bots look alike.
//
// A stylist added later falls through to the hash and still gets a stable face;
// add it here when it needs to be distinct from an existing one.
const FACE_BY_NAME: Record<string, number> = {
  lena: 0,
  theo: 1,
  devon: 2,
  margot: 3,
  sofia: 4,
  amara: 5,
  kenji: 6,
  chloe: 7,
  priya: 8,
  mateo: 9,
  noah: 10,
  isabella: 11,
  zara: 12,
};

/**
 * Deterministic index for a seed string. FNV-1a rather than a `* 31` rolling
 * hash: the latter clusters badly on short names over a small table.
 */
export function botFaceIndex(seed: string): number {
  const named = FACE_BY_NAME[seed.trim().toLowerCase()];
  if (named !== undefined) return named;
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h) % FACES.length;
}

/** How many distinct faces exist — handy for tests and admin previews. */
export const BOT_FACE_COUNT = FACES.length;

export function BotFace({ seed, className }: { seed: string; className?: string }) {
  const face = FACES[botFaceIndex(seed)];
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {face()}
    </svg>
  );
}
