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
 *  everywhere else. Width matches the card's device-pixel budget. */
export const CARD_POSTER_WIDTH = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches ? 480 : 720;

export function posterRendition(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return withTransform(raw, { width: CARD_POSTER_WIDTH, quality: 82, resize: 'contain' }) || raw;
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
