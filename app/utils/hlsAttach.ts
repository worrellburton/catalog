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
//   • Safari / iOS  → native HLS. Just set `el.src = manifestUrl`. (No hls.js
//     download at all — and iOS is a big share of our mobile traffic.)
//   • Everyone else → hls.js, LAZY-loaded via dynamic import the first time an
//     HLS source is actually encountered. Until a clip is backfilled with an
//     `hls_url`, hls.js is never fetched, so it stays out of the initial bundle.
//
// `capLevelToPlayerSize: true` is the key knob: a tiny grid tile resolves to
// the 480p rung, and when TrailVideoHost moves that same element into the
// full-screen hero (bigger box) hls.js re-evaluates and ramps to the high rung.
//
// BACKWARD-COMPATIBLE BY DESIGN: for a plain MP4 url, setVideoSource is
// `if (el.src !== url) el.src = url` and detachSource is
// `removeAttribute('src'); load()` — byte-identical to the previous inline
// code, so callers behave exactly as before until an `hls_url` is populated.

import type HlsType from 'hls.js';
import { videoPipelineMode } from '~/services/video-pipeline';

// Minimal surface of the hls.js instance we use — lets us avoid a value import
// (which would pull hls.js into the main bundle).
type HlsInstance = Pick<HlsType, 'loadSource' | 'attachMedia' | 'destroy'>;

// Lazy module loader — the dynamic import is what makes Vite split hls.js into
// its own chunk, fetched only when the first HLS source appears.
let hlsModPromise: Promise<typeof import('hls.js')> | null = null;
function loadHls(): Promise<typeof import('hls.js')> {
  return (hlsModPromise ??= import('hls.js'));
}

// ── Phase 1/4: native-HLS detection + hls.js preferences ──────────────
// Cached: does THIS browser play HLS natively (Safari, iOS WebView — i.e. the
// Flutter shell on iOS)? Those never need hls.js. Mirrors the per-element
// canPlayNativeHls() below but element-free, so warmers/the director can branch
// on it without holding a <video>.
let _nativeHlsSupport: boolean | null = null;
export function browserSupportsNativeHls(): boolean {
  if (_nativeHlsSupport !== null) return _nativeHlsSupport;
  if (typeof document === 'undefined') return false;
  try {
    _nativeHlsSupport =
      document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';
  } catch {
    _nativeHlsSupport = false;
  }
  return _nativeHlsSupport;
}

// Cached: can THIS browser decode HEVC (hvc1) in MP4? canPlayType is reliable
// here because the only caller (pickPlaybackSource) ALSO gates on
// browserSupportsNativeHls() — i.e. it only prefers the HEVC ladder on
// Apple/native-HLS devices, which have hardware HEVC decode AND honest
// canPlayType results. We never steer the hls.js/MSE path to HEVC (decode there
// is rare/unreliable), so this stays a sync, allocation-free check.
let _hevcSupport: boolean | null = null;
export function browserDecodesHevc(): boolean {
  if (_hevcSupport !== null) return _hevcSupport;
  if (typeof document === 'undefined') return false;
  try {
    const v = document.createElement('video');
    // hvc1.1.6.L93.B0 == Main profile, the tag (-tag:v hvc1) the encoder emits.
    _hevcSupport = v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') !== '';
  } catch {
    _hevcSupport = false;
  }
  return _hevcSupport;
}

// Phase 4 (opt-in, default OFF): route HLS through hls.js even where native HLS
// is available, using Managed Media Source on iOS 17.1+. Native HLS stays the
// default — it needs no library download and is battery-friendly — so this
// CANNOT regress the native path unless explicitly switched on. Enable for
// testing with localStorage 'hls-prefer-mse'='1'.
function preferHlsJsOverNative(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem('hls-prefer-mse') === '1';
  } catch {
    return false;
  }
}

/** Phase 1: pre-load the hls.js chunk during idle so the FIRST HLS card of a
 *  session doesn't stall on the dynamic import before it can even attach.
 *  No-op on native-HLS browsers (they never download hls.js), on save-data,
 *  and in 'mp4' pipeline mode (no surface will request an HLS source; if a
 *  stray manifest does reach setVideoSource it lazy-loads hls.js then).
 *  Safe to call repeatedly — loadHls() memoizes the import. */
export function prefetchHlsModule(): void {
  if (videoPipelineMode() === 'mp4') return;
  if (typeof navigator !== 'undefined') {
    const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (c?.saveData) return;
  }
  if (browserSupportsNativeHls() && !preferHlsJsOverNative()) return;
  void loadHls().catch(() => { /* will retry lazily on the first real attach */ });
}

// One hls.js instance per element, tracked off to the side so callers
// (TrailVideoHost pool entries) don't have to thread it through their own
// bookkeeping. WeakMap so a GC'd element takes its instance with it.
const hlsByEl = new WeakMap<HTMLVideoElement, HlsInstance>();
// The source each element is CURRENTLY meant to play. Set synchronously by
// setVideoSource / cleared by detachSource, then re-checked inside the async
// hls.js import callback so a detach (or a newer setVideoSource) that lands
// while hls.js is still downloading cancels the stale attach.
const desiredByEl = new WeakMap<HTMLVideoElement, string | null>();

/** True when the URL points at an HLS manifest (.m3u8, optionally query'd). */
export function isHlsUrl(url: string | null | undefined): boolean {
  return !!url && /\.m3u8(\?.*)?$/i.test(url);
}

/** The logical source URL an element is currently serving. For MP4 this is
 *  just `el.src`; for HLS, hls.js replaces `el.src` with an MSE blob, so we
 *  return the tracked manifest URL instead. Callers that key pool reuse off
 *  "what clip is this element playing" (the feed director) MUST use this
 *  rather than reading `el.src` directly. Empty string when nothing is set
 *  or the element has been detached. */
export function getVideoSource(el: HTMLVideoElement): string {
  return desiredByEl.get(el) || el.src || '';
}

/** True when the browser can play HLS natively (Safari, iOS WebView — i.e.
 *  the Flutter shell on iOS). Those never need hls.js. */
function canPlayNativeHls(el: HTMLVideoElement): boolean {
  return el.canPlayType('application/vnd.apple.mpegurl') !== '';
}

// Shared hls.js tuning. Short buffers keep many concurrent feed decoders from
// ballooning memory; capLevelToPlayerSize makes each element pick the rung that
// fits its on-screen size (tile → 480p, hero → 1080p) and re-pick when moved.
function hlsConfig(): Partial<HlsType['config']> {
  return {
    capLevelToPlayerSize: true,
    startLevel: -1,        // auto: start low for fast first frame, ABR ramps up
    maxBufferLength: 12,   // seconds — clips are short; don't over-buffer
    maxMaxBufferLength: 24,
    backBufferLength: 6,
    fragLoadingMaxRetry: 2,
    manifestLoadingMaxRetry: 2,
  };
}

function destroyHls(el: HTMLVideoElement): void {
  const prev = hlsByEl.get(el);
  if (prev) { try { prev.destroy(); } catch { /* ignore */ } hlsByEl.delete(el); }
}

/**
 * Point `el` at `url`, handling HLS vs MP4. Safe to call repeatedly; for a
 * plain MP4 it's a no-op when the src already matches. The caller owns when
 * to call this (TrailVideoHost does so from attach/prewarm).
 */
export function setVideoSource(el: HTMLVideoElement, url: string): void {
  desiredByEl.set(el, url);

  if (isHlsUrl(url)) {
    if (canPlayNativeHls(el) && !preferHlsJsOverNative()) {
      // Native HLS — tear down any prior hls.js instance, then set src.
      destroyHls(el);
      if (el.src !== url) el.src = url;
      return;
    }
    const existing = hlsByEl.get(el);
    if (existing) {
      // Reuse the live instance to switch manifests (rare: pooled element,
      // new clip) — no second attach cycle.
      try { existing.loadSource(url); } catch { /* ignore */ }
      return;
    }
    // A plain `src` attribute would race hls.js's MSE attach — clear it, then
    // lazy-load hls.js and attach when it arrives (poster covers the gap).
    el.removeAttribute('src');
    void loadHls().then(({ default: Hls }) => {
      // Superseded by a detach or a newer source while downloading? Abort.
      if (desiredByEl.get(el) !== url) return;
      if (hlsByEl.get(el)) return; // another call already attached
      if (!Hls.isSupported()) { el.src = url; return; }
      const hls = new Hls(hlsConfig());
      hls.loadSource(url);
      hls.attachMedia(el);
      hlsByEl.set(el, hls);
    }).catch(() => { if (desiredByEl.get(el) === url) { try { el.src = url; } catch { /* ignore */ } } });
    return;
  }

  // Plain progressive MP4 — identical to the legacy inline behaviour. Destroy
  // any hls.js instance first (covers a pooled element switching HLS → MP4).
  destroyHls(el);
  if (el.src !== url) el.src = url;
}

/**
 * Release the element's source and free its decoder. Cancels any in-flight
 * hls.js attach, destroys a live instance, then strips `src` + load() — the
 * MP4 path is byte-identical to the previous `removeAttribute('src'); load()`.
 */
export function detachSource(el: HTMLVideoElement): void {
  desiredByEl.set(el, null);
  destroyHls(el);
  try { el.removeAttribute('src'); el.load(); } catch { /* ignore */ }
}
