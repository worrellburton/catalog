// Shared helpers for picking the right video URL on the right device,
// preloading high-res variants in the background, and capturing canvas
// frames for instant tap-into-detail handoffs. The performance contract
// for the consumer feed lives here.
//
// Why a separate file: every render site (CreativeCard, LookCard,
// TrailVideoHost, ProductPage hero, "More like this" rail, "You might
// also like" rail) needs the same picking + preload logic. Centralizing
// it means one tweak (e.g. lifting the mobile cutoff to 1024px, or
// gating the Phase 8 preload behind navigator.connection) applies
// everywhere instead of drifting across 6 components.

import type { ProductAd } from './product-creative';

// ── Phase 6: pick the right URL for this device ───────────────────────

/** True if we should serve the small mobile variant. We treat anything
 *  ≤768px wide as "mobile" - matches the breakpoint FeedSection.tsx
 *  uses for the uniform 3:4 grid. SSR returns false (desktop) so the
 *  initial render doesn't pick a missing URL. */
export function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= 768;
}

/** True if we're on a connection slow enough that the mobile variant
 *  is worth picking even on a wider viewport (slow desktop / hotspot
 *  tethering / etc.). Wraps the Network Information API; falls back to
 *  false on browsers that don't expose it (Safari). */
export function isSlowConnection(): boolean {
  if (typeof navigator === 'undefined') return false;
  const c = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection;
  if (!c) return false;
  if (c.saveData) return true;
  return c.effectiveType === 'slow-2g' || c.effectiveType === '2g' || c.effectiveType === '3g';
}

/** Picks `mobile_video_url` when we're on a mobile viewport / slow
 *  connection AND the variant exists; otherwise falls back to the
 *  full-res `video_url`. Never returns an empty string - the caller
 *  is responsible for the null case (no playable variant at all).
 *
 *  Product preference: when the joined product carries a
 *  `primary_video_url` (the polished i2v Seedance clip we generate
 *  per-SKU), we prefer it over the creative's legacy `video_url` —
 *  product cards in the feed should surface the canonical product
 *  video, not whatever ad clip was minted earlier. Look cards still
 *  use the creative's own video. */
export function pickVideoUrl(creative: {
  video_url?: string | null;
  mobile_video_url?: string | null;
  product?: { primary_video_url?: string | null } | null;
}): string | null {
  const primary = creative.product?.primary_video_url;
  if (primary) return primary;
  const wantMobile = isMobileViewport() || isSlowConnection();
  if (wantMobile && creative.mobile_video_url) return creative.mobile_video_url;
  return creative.video_url ?? creative.mobile_video_url ?? null;
}

/** Picks the best poster image. Order:
 *    1. Vision-picked + polished primary product image (clean packshot)
 *    2. Creative thumbnail (a frame extracted at upload time)
 *    3. Legacy product image_url
 *    4. First product image
 *    5. Empty string - caller renders nothing.
 *  Used as the <video poster=> attribute so the browser paints a
 *  real image on first paint, before the MP4 has decoded a frame.
 *
 *  primary_video_poster_url leads: it's the primary video's FRAME 0 at the
 *  clip's native 3:4 size, so it fills the 3:4 card with no crop-zoom AND is
 *  pixel-identical to the frame the <video> paints when it starts — the
 *  poster→playback handoff is seamless (no zoom pop) and the still is the
 *  clip's widest, least-zoomed framing. primary_image_url (the polished
 *  packshot) is the fallback for products whose poster hasn't been
 *  backfilled. */
export function pickPosterUrl(creative: {
  thumbnail_url?: string | null;
  product?: { image_url?: string | null; primary_image_url?: string | null; primary_video_poster_url?: string | null; images?: string[] | null } | null;
}): string {
  return creative.product?.primary_video_poster_url
    || creative.product?.primary_image_url
    || creative.thumbnail_url
    || creative.product?.image_url
    || (creative.product?.images && creative.product.images[0])
    || '';
}

/** Picks the best STILL image — used when the global Video → Still
 *  dial pushes a card into the image-only path. Prefers the
 *  vision-picked solo-product image (primary_image_url) so the feed
 *  always merchandises clean packshots over lifestyle / on-model
 *  frames. Falls back to legacy image_url → images[0] → thumbnail
 *  only when the picker hasn't run on this product yet. */
export function pickStillImageUrl(creative: {
  thumbnail_url?: string | null;
  product?: { image_url?: string | null; primary_image_url?: string | null; primary_video_poster_url?: string | null; images?: string[] | null } | null;
}): string {
  // Prefer the 3:4 video poster when present so a forced-still product
  // tile fills the card the same way the clip would — no crop-zoom.
  return creative.product?.primary_video_poster_url
    || creative.product?.primary_image_url
    || creative.product?.image_url
    || (creative.product?.images && creative.product.images[0])
    || creative.thumbnail_url
    || '';
}

// ── Phase 8: background-preload full-res for in-viewport cards ────────
// Once a card has been visible for ~500ms on mobile, kick off a
// low-priority fetch of the desktop-quality video bytes. The browser
// caches by URL, so when the user taps into the detail view the
// <video src={fullResUrl}> element gets a cache hit - no redownload,
// no decode lag.
//
// Gated behind navigator.connection so we don't melt 3G data plans
// and behind a Set so we never queue the same URL twice per page load.

const preloadedHighResUrls = new Set<string>();
const preloadAbortControllers = new Map<string, AbortController>();

/** True when it's safe to spend bytes on a background prefetch. Skips
 *  on save-data, slow-2g/2g/3g, and when the data-saver flag is on. */
function canBackgroundPreload(): boolean {
  if (typeof navigator === 'undefined') return false;
  const c = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection;
  if (!c) return true; // unknown - assume modern wifi
  if (c.saveData) return false;
  return c.effectiveType !== 'slow-2g' && c.effectiveType !== '2g' && c.effectiveType !== '3g';
}

/** Background-fetch a video URL into the browser's HTTP cache.
 *  We fetch the FULL file, not a byte range. A 206 Partial-Content
 *  response is NOT reused by the browser HTTP cache (verified: repeated
 *  Range fetches get zero speedup), so a `Range: bytes=0-…` prewarm
 *  warmed nothing the <video> could reuse. A full 200 GET IS cached and
 *  reused, so the subsequent <video> load — including a scroll-back
 *  re-entry — is a cache hit. Clips are small and the concurrency cap
 *  below bounds how many download at once. */
// Concurrency cap: never have more than this many prewarm fetches in
// flight at once, so a fast scroll past 20 cards can't open 20 sockets
// that starve the clip the user is actually watching. Excess URLs queue
// and start as earlier ones finish.
const MAX_PREFETCH_CONCURRENCY = 4;
// Backlog cap. After a fast flick the pending queue would otherwise fill
// with cards the user has already blown PAST. Keeping it small means the
// bytes we spend are always for cards near where the user currently is.
const MAX_PENDING_PREFETCH = 10;
let prefetchInFlight = 0;
const prefetchQueue: string[] = [];

function pumpPrefetchQueue(): void {
  while (prefetchInFlight < MAX_PREFETCH_CONCURRENCY && prefetchQueue.length > 0) {
    // LIFO: serve the MOST-recently requested URL first. Cards enter the
    // prewarm band in scroll order, so on a fast flick the clip the user
    // actually STOPS on is the last one pushed — popping newest-first lets it
    // start buffering immediately instead of waiting behind a long backlog of
    // cards already scrolled past (which read as "poster holds for a few
    // seconds, then plays"). Slow scroll has a near-empty queue, so LIFO vs
    // FIFO is a no-op there.
    const next = prefetchQueue.pop()!;
    startPrefetch(next);
  }
}

export function prefetchVideoBytes(url: string | null | undefined): void {
  if (!url) return;
  if (preloadedHighResUrls.has(url)) return;
  if (!canBackgroundPreload()) return;
  preloadedHighResUrls.add(url);
  prefetchQueue.push(url);
  // Drop the OLDEST pending entries (front of the queue = farthest from where
  // the user now is) when the backlog overflows, so we never burn bandwidth on
  // long-gone cards while the clip under the user's thumb waits. Un-mark them
  // so they can re-queue if scrolled back into view later.
  while (prefetchQueue.length > MAX_PENDING_PREFETCH) {
    const stale = prefetchQueue.shift()!;
    preloadedHighResUrls.delete(stale);
  }
  pumpPrefetchQueue();
}

function startPrefetch(url: string): void {
  prefetchInFlight++;
  const ctrl = new AbortController();
  preloadAbortControllers.set(url, ctrl);
  // Full GET at lowest priority so we don't compete with the in-viewport
  // clip the user is watching. No Range header — a 206 isn't cache-reused,
  // a 200 is (see prefetchVideoBytes doc above).
  fetch(url, {
    method: 'GET',
    signal: ctrl.signal,
    priority: 'low' as RequestPriority,
  } as RequestInit & { priority: RequestPriority })
    .then(async r => {
      // Drain the body to EOF so the browser commits a COMPLETE, reusable
      // cache entry (a half-read 200 may be dropped, same failure mode as a
      // 206). Chunks are discarded as they arrive, so memory stays flat —
      // we want the bytes in the HTTP cache, not in JS.
      const reader = r.body?.getReader();
      if (!reader) return;
      try {
        for (;;) {
          const { done } = await reader.read();
          if (done) break;
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    })
    .catch(() => { /* aborted or offline - nothing to do */ })
    .finally(() => {
      preloadAbortControllers.delete(url);
      prefetchInFlight--;
      pumpPrefetchQueue();
    });
}

/** Number of distinct URLs prewarmed this page-load. Used by the debug HUD. */
export function getPrefetchCount(): number {
  return preloadedHighResUrls.size;
}

/** Cancels any pending high-res preload. Use on route change so the
 *  outgoing feed doesn't keep burning bytes after the user has moved
 *  on. */
export function cancelAllHighResPreloads(): void {
  preloadAbortControllers.forEach(ctrl => ctrl.abort());
  preloadAbortControllers.clear();
  // Note: we intentionally don't clear preloadedHighResUrls. If the
  // user comes back to the feed, those URLs are still cached and a
  // re-trigger should be a no-op.
}

// ── Phase 9: capture a card's playing frame for tap-to-detail handoff
// Right before navigating from feed → detail view, draw the card's
// playing <video> onto an offscreen canvas and stash the data URL.
// The detail view picks it up as its initial poster, so the hero
// shows the exact frame the user just clicked - no black flash.

/** Snapshot the current frame of a playing <video> as a JPEG data URL.
 *  Returns null if the video has no decoded frames yet (cold-start tap)
 *  or if canvas drawing fails (cross-origin without proper CORS, etc.). */
export function captureVideoFrame(video: HTMLVideoElement | null): string | null {
  if (!video) return null;
  if (video.readyState < 2) return null; // no decoded frame to paint
  try {
    const w = video.videoWidth || 480;
    const h = video.videoHeight || 640;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    // 0.7 quality keeps the data URL under ~80KB at 480x640, which is
    // small enough to pass through history.state without bloat.
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    // Tainted canvas - we set crossOrigin="anonymous" on every <video>
    // for exactly this reason, but if the storage bucket ever forgets
    // CORS we silently degrade to no handoff (still falls through to
    // the static thumbnail_url).
    return null;
  }
}

// ── Phase 10: light-touch telemetry ───────────────────────────────────
// performance.mark wrappers so we can measure the before/after on the
// "feed mount → first frame painted" path without bringing in a full
// analytics SDK. In production a Sentry/Mixpanel hook can subscribe to
// these marks if we ever want server-side timing.

/** Mark a milestone for the feed-load journey. No-op outside the browser. */
export function markFeedMilestone(name: string): void {
  if (typeof performance === 'undefined' || !performance.mark) return;
  try { performance.mark(`feed:${name}`); } catch { /* ignore */ }
}
