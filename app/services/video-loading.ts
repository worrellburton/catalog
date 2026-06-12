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
import { videoPipelineMode } from './video-pipeline';
import { browserSupportsNativeHls, browserDecodesHevc } from '~/utils/hlsAttach';

// ── AV1 desktop-decode probe (async, cached) ──────────────────────────
// AV1 is a SIZE win on the desktop progressive path (~30-50% vs H.264 at equal
// quality). We MUST gate on MediaCapabilities.decodingInfo (NOT canPlayType):
// M1/M2 Safari reports nominal AV1 support via canPlayType but has no working
// decoder, so a canPlayType gate would black out those heroes. We probe once at
// module load and cache a boolean; pickVideoUrl reads it synchronously and
// defaults to FALSE (→ H.264) until the probe resolves, so nothing regresses.
let _av1Decode = false;
function probeAv1Decode(): void {
  if (typeof navigator === 'undefined') return;
  const mc = (navigator as Navigator & {
    mediaCapabilities?: { decodingInfo?: (c: unknown) => Promise<{ supported: boolean; smooth: boolean; powerEfficient: boolean }> };
  }).mediaCapabilities;
  if (!mc?.decodingInfo) return; // no API → stay on H.264
  mc.decodingInfo({
    type: 'file',
    video: {
      contentType: 'video/mp4; codecs="av01.0.05M.08"',
      width: 1080, height: 1440, bitrate: 3_000_000, framerate: 24,
    },
  })
    .then((r) => { _av1Decode = !!(r && r.supported && r.smooth && r.powerEfficient); })
    .catch(() => { /* leave false — H.264 stays */ });
}
// Kick the probe once at module init (guarded for SSR). Idempotent enough — the
// module is a singleton, so this runs a single decodingInfo call per session.
probeAv1Decode();

/** True only when AV1 is the right pick for THIS surface: the device has a
 *  confirmed-smooth AV1 decoder AND we're on the desktop/wifi path (AV1 is the
 *  desktop progressive-MP4 lever; mobile rides HLS). Sync + stable per session,
 *  so a card and its hero always agree → the pooled-element handoff never has to
 *  swap the source. */
function av1Preferred(): boolean {
  return _av1Decode && !isMobileViewport() && !isSlowConnection();
}

/** True only when the HEVC ladder is the right pick: native-HLS device (iOS/
 *  Safari) that decodes HEVC in hardware. We never steer the hls.js/MSE path to
 *  HEVC. Sync + stable per session → tile and hero agree. */
function hevcPreferred(): boolean {
  return browserSupportsNativeHls() && browserDecodesHevc();
}

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
  video_av1_url?: string | null;
  product?: { primary_video_url?: string | null; primary_video_av1_url?: string | null } | null;
}): string | null {
  // AV1 desktop preference (gated on a confirmed-smooth decoder; null falls
  // through to H.264). Decided per device, so a tile and its hero resolve to the
  // SAME url and the pooled-element handoff never swaps source.
  const av1 = av1Preferred();
  const primary = creative.product?.primary_video_url;
  if (primary) {
    if (av1 && creative.product?.primary_video_av1_url) return creative.product.primary_video_av1_url;
    return primary;
  }
  const wantMobile = isMobileViewport() || isSlowConnection();
  if (wantMobile && creative.mobile_video_url) return creative.mobile_video_url;
  if (av1 && creative.video_av1_url) return creative.video_av1_url;
  return creative.video_url ?? creative.mobile_video_url ?? null;
}

/** Picks the playback source, preferring an HLS manifest when one exists.
 *
 *  HLS is a single adaptive source used by EVERY surface (grid tile, detail
 *  hero): the player starts on a low rung for an instant first frame and
 *  ramps up to a high rung as bandwidth + element size allow — no src swap,
 *  no black flash. Because the tile and the hero point at the SAME manifest,
 *  TrailVideoHost's card→hero handoff stays seamless AND full-screen
 *  auto-upgrades to crisp. When no manifest is present we fall straight
 *  through to pickVideoUrl()'s progressive-MP4 logic (mobile/full split),
 *  so behaviour is unchanged until clips are backfilled with an `hls_url`.
 *
 *  Product preference mirrors pickVideoUrl: a product's own HLS ladder
 *  (primary_hls_url) wins for product cards.
 *
 *  HEVC preference: on native-HLS devices that decode HEVC (iOS/Safari) the
 *  HEVC ladder (hls_hevc_url / primary_hls_hevc_url) is preferred for ~15-25%
 *  fewer bytes; AVPlayer auto-picks the rung. We never steer the hls.js path to
 *  HEVC. Null HEVC columns fall straight through to the H.264 ladder, so this is
 *  identical to today's behaviour until clips are backfilled.
 *
 *  Pipeline dial (/admin/dials → video_pipeline_mode): in 'mp4' mode the
 *  HLS columns are ignored entirely and every surface gets the legacy
 *  progressive path — byte-identical to pre-HLS behaviour. */
export function pickPlaybackSource(creative: {
  hls_url?: string | null;
  hls_hevc_url?: string | null;
  video_url?: string | null;
  mobile_video_url?: string | null;
  video_av1_url?: string | null;
  product?: {
    primary_hls_url?: string | null;
    primary_hls_hevc_url?: string | null;
    primary_video_url?: string | null;
    primary_video_av1_url?: string | null;
  } | null;
}): string | null {
  if (videoPipelineMode() === 'mp4') return pickVideoUrl(creative);
  // HEVC ladder preferred where decodable (product-level first, mirroring the
  // H.264 precedence below). Null → fall through to H.264.
  if (hevcPreferred()) {
    if (creative.product?.primary_hls_hevc_url) return creative.product.primary_hls_hevc_url;
    if (creative.hls_hevc_url) return creative.hls_hevc_url;
  }
  const productHls = creative.product?.primary_hls_url;
  if (productHls) return productHls;
  if (creative.hls_url) return creative.hls_url;
  return pickVideoUrl(creative);
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
// Concurrency cap: never have more than N prewarm fetches in flight at
// once, so a fast scroll past 20 cards can't open 20 sockets that starve
// the clip the user is actually watching. Excess URLs queue and start as
// earlier ones finish. N and the backlog cap below are admin dials
// (/admin/dials → Video delivery), read live from the pipeline config.
let prefetchInFlight = 0;
const prefetchQueue: string[] = [];

// Hardcoded best-performance prewarm settings (formerly admin dials, removed).
// Only the delivery pipeline (HLS vs MP4) stays user-switchable; everything
// about HOW we warm is fixed here at the values that proved instant + lag-free.
//
//   PREWARM_CONCURRENCY 4 — max simultaneous full-file MP4 prewarms. This is
//     the pre-HLS value; 8 (the old maxed-out dial) over-saturated the
//     connection and starved the on-screen clip (the MP4 lag / black-grid).
//   PREWARM_QUEUE_CAP 10  — pending backlog cap; on a fast flick the oldest
//     queued cards are dropped so bytes go where the user actually is.
//   PREWARM_CACHE_MODE 'default' — normal HTTP caching, so prewarmed bytes are
//     reused on playback (the whole point of warming).
//   HLS_WARM_SEGMENTS 2   — media segments warmed per upcoming HLS clip head
//     (lowest rung): manifest + init + first 2 segments = instant first frame
//     plus a smooth start, without over-fetching upcoming clips.
const PREWARM_CONCURRENCY = 4;
const PREWARM_QUEUE_CAP = 10;
const PREWARM_CACHE_MODE: RequestCache = 'default';
const HLS_WARM_SEGMENTS = 2;

function pumpPrefetchQueue(): void {
  while (prefetchInFlight < PREWARM_CONCURRENCY && prefetchQueue.length > 0) {
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
  while (prefetchQueue.length > PREWARM_QUEUE_CAP) {
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
    cache: PREWARM_CACHE_MODE,
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

// ── HLS head-warm: pre-buffer upcoming adaptive clips ─────────────────
// prefetchVideoBytes only helps progressive MP4 — for HLS (.m3u8) the
// player streams its OWN segments on demand via hls.js, so a full-file
// GET warms nothing reusable. To make an upcoming HLS card play without a
// visible load, we warm what hls.js will request FIRST: the manifest, the
// lowest-bitrate variant's media playlist, its init segment (fMP4), and
// the first 1-2 media segments — all into the HTTP cache. hls.js then
// attaches to a cache hit and the first frame paints near-instantly.
//
// We deliberately warm the LOWEST rung (matches hls.js startLevel:-1,
// which starts low for a fast first frame and ramps up via ABR), so the
// bytes spent ahead are minimal. Same gating as prefetchVideoBytes
// (saveData / 2g-3g skip) plus its own small concurrency + LIFO backlog so
// a fast flick can't open a flood of segment fetches.

const warmedHlsManifests = new Set<string>();
const MAX_HLS_WARM_CONCURRENCY = 3;
const MAX_PENDING_HLS_WARM = 8;
let hlsWarmInFlight = 0;
const hlsWarmQueue: string[] = [];

function isHlsManifest(url: string): boolean {
  return /\.m3u8(\?|#|$)/i.test(url);
}

function pumpHlsWarmQueue(): void {
  // Pipeline switched to 'mp4' mid-drain: drop the queued HLS heads so we don't
  // keep warming manifests the player won't use in the new mode. Un-mark them
  // so a flip back can re-queue.
  if (videoPipelineMode() !== 'hls') {
    for (const u of hlsWarmQueue) warmedHlsManifests.delete(u);
    hlsWarmQueue.length = 0;
    return;
  }
  while (hlsWarmInFlight < MAX_HLS_WARM_CONCURRENCY && hlsWarmQueue.length > 0) {
    // LIFO: newest (nearest to where the user is heading) first, same
    // rationale as the MP4 prewarm queue.
    const next = hlsWarmQueue.pop()!;
    void runHlsWarm(next);
  }
}

/** Warm the head of an upcoming HLS clip so hls.js gets cache hits when it
 *  attaches. No-op for non-HLS URLs, on save-data/slow connections, for a
 *  manifest already warmed this page-load, or when the pipeline is in 'mp4'
 *  mode (nothing will play HLS). */
export function prefetchHlsHead(manifestUrl: string | null | undefined): void {
  if (!manifestUrl || !isHlsManifest(manifestUrl)) return;
  if (videoPipelineMode() !== 'hls') return;
  if (warmedHlsManifests.has(manifestUrl)) return;
  if (!canBackgroundPreload()) return;
  warmedHlsManifests.add(manifestUrl);
  hlsWarmQueue.push(manifestUrl);
  // Drop the oldest pending manifests (farthest from the user now) on
  // overflow, un-marking them so they can re-queue if scrolled back to.
  while (hlsWarmQueue.length > MAX_PENDING_HLS_WARM) {
    const stale = hlsWarmQueue.shift()!;
    warmedHlsManifests.delete(stale);
  }
  pumpHlsWarmQueue();
}

async function fetchManifestText(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { method: 'GET', cache: PREWARM_CACHE_MODE, priority: 'low' as RequestPriority } as RequestInit & { priority: RequestPriority });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

/** Full low-priority GET, body drained to EOF so the browser commits a
 *  complete, reusable cache entry (mirrors startPrefetch's contract). */
async function warmSegmentBytes(url: string): Promise<void> {
  try {
    const r = await fetch(url, { method: 'GET', cache: PREWARM_CACHE_MODE, priority: 'low' as RequestPriority } as RequestInit & { priority: RequestPriority });
    const reader = r.body?.getReader();
    if (!reader) return;
    try {
      for (;;) { const { done } = await reader.read(); if (done) break; }
    } finally {
      await reader.cancel().catch(() => {});
    }
  } catch {
    /* aborted / offline — nothing to do */
  }
}

/** From a master playlist, pick the lowest-BANDWIDTH variant URI (matches
 *  hls.js's low start level). Returns null if it isn't a master playlist. */
function pickLowestVariant(masterText: string): string | null {
  const lines = masterText.split(/\r?\n/);
  let bestUri: string | null = null;
  let bestBw = Infinity;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith('#EXT-X-STREAM-INF')) continue;
    const m = lines[i].match(/BANDWIDTH=(\d+)/i);
    const bw = m ? parseInt(m[1], 10) : 0;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    const uri = lines[j]?.trim();
    if (uri && !uri.startsWith('#') && bw < bestBw) { bestBw = bw; bestUri = uri; }
  }
  return bestUri;
}

/** From a media playlist, return the init segment URI (fMP4 #EXT-X-MAP) and
 *  the first `max` media-segment URIs (max 0 → init/manifest warm only). */
function parseFirstSegments(mediaText: string, max: number): { initUri: string | null; segUris: string[] } {
  const segUris: string[] = [];
  let initUri: string | null = null;
  for (const raw of mediaText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-MAP:')) {
      const m = line.match(/URI="([^"]+)"/);
      if (m) initUri = m[1];
      continue;
    }
    if (line.startsWith('#')) continue;
    if (segUris.length >= max) break;
    segUris.push(line);
  }
  return { initUri, segUris };
}

async function runHlsWarm(manifestUrl: string): Promise<void> {
  hlsWarmInFlight++;
  try {
    const masterText = await fetchManifestText(manifestUrl);
    if (!masterText) return;
    let mediaUrl = manifestUrl;
    let mediaText = masterText;
    // Master playlist → resolve the lowest-bitrate media playlist first.
    if (masterText.includes('#EXT-X-STREAM-INF')) {
      const variant = pickLowestVariant(masterText);
      if (!variant) return;
      mediaUrl = new URL(variant, manifestUrl).href;
      const t = await fetchManifestText(mediaUrl);
      if (!t) return;
      mediaText = t;
    }
    const { initUri, segUris } = parseFirstSegments(mediaText, HLS_WARM_SEGMENTS);
    if (initUri) await warmSegmentBytes(new URL(initUri, mediaUrl).href);
    for (const s of segUris) await warmSegmentBytes(new URL(s, mediaUrl).href);
  } finally {
    hlsWarmInFlight--;
    pumpHlsWarmQueue();
  }
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
