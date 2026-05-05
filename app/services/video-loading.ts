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
 *  is responsible for the null case (no playable variant at all). */
export function pickVideoUrl(creative: Pick<ProductAd, 'video_url' | 'mobile_video_url'>): string | null {
  const wantMobile = isMobileViewport() || isSlowConnection();
  if (wantMobile && creative.mobile_video_url) return creative.mobile_video_url;
  return creative.video_url ?? creative.mobile_video_url ?? null;
}

/** Picks the best poster image. Order:
 *    1. Creative thumbnail (a frame extracted at upload time)
 *    2. First product image (always populated)
 *    3. Empty string - caller renders nothing.
 *  Used as the <video poster=> attribute so the browser paints a
 *  real image on first paint, before the MP4 has decoded a frame. */
export function pickPosterUrl(creative: {
  thumbnail_url?: string | null;
  product?: { image_url?: string | null; images?: string[] | null } | null;
}): string {
  return creative.thumbnail_url
    || creative.product?.image_url
    || (creative.product?.images && creative.product.images[0])
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

/** Background-fetch a video URL into the browser's HTTP cache. Range:
 *  bytes=0-262143 (~256KB) is enough to grab the moov atom + first GOP
 *  on a typical short MP4, which is what the <video> element actually
 *  needs to start playing. Pulling the whole file in the background
 *  would double the bytes a scrolling user spends; we'd rather warm
 *  the cache for "the first frame is ready" and let the rest stream
 *  on demand once the user taps in. */
export function prefetchVideoBytes(url: string | null | undefined): void {
  if (!url) return;
  if (preloadedHighResUrls.has(url)) return;
  if (!canBackgroundPreload()) return;
  preloadedHighResUrls.add(url);
  const ctrl = new AbortController();
  preloadAbortControllers.set(url, ctrl);
  // Range request grabs just enough to make first-frame decode instant.
  // Some Supabase storage URLs ignore the Range header but the response
  // is still cached, so worst case we paid for the whole file - same as
  // a direct GET would have done.
  fetch(url, {
    method: 'GET',
    signal: ctrl.signal,
    headers: { Range: 'bytes=0-262143' },
    // Lowest priority so we don't compete with the in-viewport video
    // that the user is actually watching.
    priority: 'low' as RequestPriority,
    // Ditto for the credentials policy - default 'same-origin' is fine
    // for Supabase public URLs.
  } as RequestInit & { priority: RequestPriority })
    .then(r => r.arrayBuffer())  // drain the stream so the browser commits to cache
    .catch(() => { /* aborted or offline - nothing to do */ })
    .finally(() => { preloadAbortControllers.delete(url); });
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
