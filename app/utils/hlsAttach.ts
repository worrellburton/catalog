// hlsAttach — one choke point for pointing a <video> at a playback source,
// transparently handling HLS (adaptive bitrate) where the source is an
// `.m3u8` manifest and plain progressive MP4 everywhere else.
//
// Why this exists
// ───────────────
// TrailVideoHost (look/product heroes + LookCard) used to assign `el.src = url`
// directly. That only works for progressive MP4. To get TikTok/Instagram-class
// "instant first frame AND crisp full-screen" we serve an HLS ladder
// (480p/720p/1080p) per clip: the player starts on a low rung for an instant
// first frame and steps UP to a high rung inside the SAME element as bandwidth
// + element size allow — no src swap, no black flash.
//
// Two delivery paths:
//   • Safari / iOS  → native HLS. Just set `el.src = manifestUrl`.
//   • Everyone else → hls.js attaches via MSE.
//
// `capLevelToPlayerSize: true` is the key knob: a tiny grid tile resolves to
// the 480p rung, and when TrailVideoHost moves that same element into the
// full-screen hero (bigger box) hls.js re-evaluates and ramps to the high
// rung — exactly the behaviour we want.
//
// BACKWARD-COMPATIBLE BY DESIGN: for a plain MP4 url, setVideoSource is
// `if (el.src !== url) el.src = url` and detachSource is
// `removeAttribute('src'); load()` — byte-identical to the previous inline
// code, so callers behave exactly as before until an `hls_url` is populated.

import Hls from 'hls.js';

// One hls.js instance per element, tracked off to the side so callers
// (TrailVideoHost pool entries) don't have to thread it through their own
// bookkeeping. WeakMap so a GC'd element takes its instance with it.
const hlsByEl = new WeakMap<HTMLVideoElement, Hls>();

/** True when the URL points at an HLS manifest (.m3u8, optionally query'd). */
export function isHlsUrl(url: string | null | undefined): boolean {
  return !!url && /\.m3u8(\?.*)?$/i.test(url);
}

/** True when the browser can play HLS natively (Safari, iOS WebView — i.e.
 *  the Flutter shell on iOS). Those never need hls.js. */
function canPlayNativeHls(el: HTMLVideoElement): boolean {
  return el.canPlayType('application/vnd.apple.mpegurl') !== '';
}

// Shared hls.js tuning. Short buffers keep many concurrent feed decoders from
// ballooning memory; capLevelToPlayerSize makes each element pick the rung that
// fits its on-screen size (tile → 480p, hero → 1080p) and re-pick when moved.
function makeHls(): Hls {
  return new Hls({
    capLevelToPlayerSize: true,
    startLevel: -1,        // auto: start low for fast first frame, ABR ramps up
    maxBufferLength: 12,   // seconds — clips are short; don't over-buffer
    maxMaxBufferLength: 24,
    backBufferLength: 6,
    // Feed clips loop; keep the loader lean so a fast scroll doesn't queue
    // dozens of segment fetches that starve the clip under the user's thumb.
    fragLoadingMaxRetry: 2,
    manifestLoadingMaxRetry: 2,
  });
}

/**
 * Point `el` at `url`, handling HLS vs MP4. Safe to call repeatedly; for a
 * plain MP4 it's a no-op when the src already matches. The caller owns when
 * to call this (TrailVideoHost does so from attach/prewarm).
 */
export function setVideoSource(el: HTMLVideoElement, url: string): void {
  const prev = hlsByEl.get(el);

  if (isHlsUrl(url)) {
    if (canPlayNativeHls(el)) {
      // Native HLS — tear down any prior hls.js instance, then set src.
      if (prev) { try { prev.destroy(); } catch { /* ignore */ } hlsByEl.delete(el); }
      if (el.src !== url) el.src = url;
      return;
    }
    if (Hls.isSupported()) {
      if (prev) {
        // Reuse the existing instance to switch manifests without a full
        // attach cycle (rare: same pooled element, new clip).
        prev.loadSource(url);
        return;
      }
      // A plain `src` attribute would race hls.js's MSE attach — clear it.
      el.removeAttribute('src');
      const hls = makeHls();
      hls.loadSource(url);
      hls.attachMedia(el);
      hlsByEl.set(el, hls);
      return;
    }
    // No HLS support anywhere — last-ditch direct assignment (will likely
    // fail to play, but the caller's poster still shows). Should never hit
    // a real browser; here for completeness.
    if (el.src !== url) el.src = url;
    return;
  }

  // Plain progressive MP4 — identical to the legacy inline behaviour.
  if (prev) { try { prev.destroy(); } catch { /* ignore */ } hlsByEl.delete(el); }
  if (el.src !== url) el.src = url;
}

/**
 * Release the element's source and free its decoder. Destroys any hls.js
 * instance first, then strips `src` + load() — the MP4 path is byte-identical
 * to the previous `removeAttribute('src'); load()`.
 */
export function detachSource(el: HTMLVideoElement): void {
  const prev = hlsByEl.get(el);
  if (prev) { try { prev.destroy(); } catch { /* ignore */ } hlsByEl.delete(el); }
  try { el.removeAttribute('src'); el.load(); } catch { /* ignore */ }
}
