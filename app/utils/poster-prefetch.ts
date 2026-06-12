// Poster fetch-ahead — the "no black tiles" half of flawless scrolling.
//
// Cards only START their poster download when React mounts them, so a
// hard flick always outran mount → fetch → decode and landed on dark
// shimmer. This module decouples the NETWORK from mounting: feed
// surfaces hand it the poster URLs for items beyond the mounted window
// and it warms them into the HTTP cache (and kicks decode) with
// low-priority Image() fetches, so by the time a card mounts its
// poster paints from cache in the same frame.
//
// - Every URL is warmed at most once per session (module-level Set).
// - A small concurrency cap keeps the warm queue from competing with
//   the posters the user is actually looking at.

import { withTransform } from '~/utils/supabase-image';

/** The ONE poster rendition every surface requests (feed cards, look
 *  product rows, overlay heroes, rails, prefetch). Identical URL ⇒
 *  identical cache entry ⇒ a poster seen anywhere paints instantly
 *  everywhere else. Width matches the card's device-pixel budget.
 *
 *  format:'webp' — posters are the first paint on every card, so the
 *  ~25–35% byte saving over JPEG (at visually-identical quality through
 *  the render CDN) directly speeds up perceived feed load. The render
 *  endpoint re-encodes on the fly, so this is a pure URL-param flip with
 *  no source re-encode; revert by dropping the `format` key. All warmers
 *  route through THIS helper, so the warmed URL stays a byte-for-byte
 *  match with what the card paints. */
export const CARD_POSTER_WIDTH = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches ? 480 : 720;

export function posterRendition(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return withTransform(raw, { width: CARD_POSTER_WIDTH, quality: 82, resize: 'contain', format: 'webp' }) || raw;
}

/** The GOVERNANCE rendition — a creative image type tuned for the type
 *  brain, where hundreds of product thumbs paint at once inside 36–64px
 *  circles. A 112px square cover crop (≈2× DPR of the largest circle)
 *  at webp q70 is ~1–3 KB each, so the whole constellation loads in one
 *  breath. One shared spec = one cache entry across satellites, drill
 *  cards and kaizen report rows. */
export function governanceRendition(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return withTransform(raw, { width: 112, height: 112, quality: 70, resize: 'cover', format: 'webp' }) || raw;
}

const warmed = new Set<string>();
const queue: string[] = [];
let inflight = 0;
const MAX_INFLIGHT = 6;

function pump(): void {
  while (inflight < MAX_INFLIGHT && queue.length > 0) {
    const url = queue.shift()!;
    inflight++;
    const img = new Image();
    (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'low';
    img.decoding = 'async';
    const done = () => {
      inflight--;
      pump();
    };
    img.onload = () => {
      // Decode off-thread now so the mount-time paint reuses the bitmap
      // instead of paying the decode on first composite.
      void img.decode?.().catch(() => { /* decode is best-effort */ });
      done();
    };
    img.onerror = done;
    img.src = url;
  }
}

/** Queue poster URLs for background warming; null/seen entries skip. */
export function warmPosters(urls: Array<string | null | undefined>): void {
  if (typeof window === 'undefined') return;
  for (const url of urls) {
    if (!url || warmed.has(url)) continue;
    warmed.add(url);
    queue.push(url);
  }
  pump();
}
