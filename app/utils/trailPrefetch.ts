// trailPrefetch - warm browser caches for the consumer feed before the user
// gets there. Two layers:
//
//   1. Posters (cheap, universally good): inject <link rel="preload" as="image">
//      for the first ~12 thumbnails and force a decode pass so they paint
//      instantly when the cards render.
//   2. Videos (expensive, network-gated): inject <link rel="preload" as="video">
//      for the first 3 only when the connection looks healthy and the user
//      hasn't enabled Save Data.
//
// Idempotent - calling twice with the same rows is a no-op.

import type { ProductAd } from '~/services/product-creative';
import type { Look } from '~/data/looks';
import { posterRendition } from './poster-prefetch';
import { pickPlaybackSource, pickPosterUrl, prefetchHlsHead } from '~/services/video-loading';
import { videoPipelineMode } from '~/services/video-pipeline';
import { isHlsUrl } from './hlsAttach';
import { lookPoster } from '~/services/media-resolver';

const POSTERS_TO_WARM = 16;
// Warm the first ~2 viewports of cards. At ~6 cards per mobile viewport
// that's 12; bumping to 18 covers fast-scrollers who blow past the
// initial set before the in-page IntersectionObserver has time to trigger
// the regular preload chain.
const VIDEOS_TO_WARM = 18;
// HLS heads route through prefetchHlsHead's bounded queue (5 in-flight, 16
// pending — see video-loading.ts). Each head now warms BOTH the low + high rung
// (the rung native iOS ramps to), so the lead matters more: warm 10 ahead so a
// card is a cache-hit well before you reach it, rather than stalling on HLS's
// 4-round-trip startup. Cap stays under the queue's pending limit. Each card
// also re-warms its own head when it enters the prewarm band.
const HLS_HEADS_TO_WARM = 10;

// Warm via posterRendition() — the SINGLE canonical poster transform the card
// actually paints (CARD_POSTER_WIDTH / q82 / webp). Sharing the one helper keeps
// the warmed URL a byte-for-byte cache hit when the card mounts; a hand-rolled
// transform here previously drifted to 540/q72 and warmed a variant the card
// never requested — double the bytes, zero benefit.

const warmedPosters = new Set<string>();
const warmedVideos = new Set<string>();

interface NavigatorWithConnection extends Navigator {
  connection?: {
    saveData?: boolean;
    effectiveType?: '2g' | '3g' | '4g' | 'slow-2g';
  };
}

function networkLooksHealthy(): boolean {
  if (typeof navigator === 'undefined') return false;
  const conn = (navigator as NavigatorWithConnection).connection;
  if (!conn) return true; // Browser doesn't expose Network Info - assume good.
  if (conn.saveData) return false;
  if (conn.effectiveType && conn.effectiveType !== '4g') return false;
  return true;
}

function injectPreload(href: string, as: 'image' | 'video', mime?: string): void {
  if (typeof document === 'undefined') return;
  // Skip if a tag for this href already exists.
  const existing = document.head.querySelector(`link[rel="preload"][href="${CSS.escape(href)}"]`);
  if (existing) return;
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = as;
  link.href = href;
  if (mime) link.type = mime;
  // crossorigin matters for media: without it the preload misses for Supabase
  // storage URLs and the browser refetches when the element actually mounts.
  if (as === 'image') link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}

async function decodeImage(url: string): Promise<void> {
  // Drop a fully-decoded copy of the bitmap into the in-memory cache. When
  // <img> later mounts at the same src, the browser reuses this cache and
  // paints on the very first frame instead of after a decode tick.
  return new Promise<void>(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.src = url;
    if (typeof img.decode === 'function') {
      img.decode().then(() => resolve(), () => resolve());
    } else {
      img.onload = () => resolve();
      img.onerror = () => resolve();
    }
  });
}

export function primeTrailAssets(rows: ProductAd[]): void {
  if (!rows?.length) return;

  // Poster warm: the first ~16 cards above-the-fold. Derive the source AND the
  // transform exactly the way CreativeCardV2 does (pickPosterUrl → withTransform)
  // so the preload is a cache hit when the card mounts — not a second,
  // differently-parameterised download. External URLs pass through unchanged.
  for (const row of rows.slice(0, POSTERS_TO_WARM)) {
    const rawPoster = pickPosterUrl(row);
    if (!rawPoster) continue;
    const poster = posterRendition(rawPoster) || rawPoster;
    if (warmedPosters.has(poster)) continue;
    warmedPosters.add(poster);
    injectPreload(poster, 'image');
    void decodeImage(poster);
  }

  // Video warm: gated on network health only (prewarm is always on now). Warm
  // the SAME source the card will actually play (pickPlaybackSource is pipeline-
  // aware): HLS manifests get a head-warm, progressive MP4s a preload link.
  if (!networkLooksHealthy()) return;
  let hlsHeads = 0;
  for (const row of rows.slice(0, VIDEOS_TO_WARM)) {
    const url = pickPlaybackSource(row);
    if (!url) continue;
    if (isHlsUrl(url)) {
      if (hlsHeads < HLS_HEADS_TO_WARM) { prefetchHlsHead(url); hlsHeads++; }
      continue;
    }
    if (warmedVideos.has(url)) continue;
    warmedVideos.add(url);
    injectPreload(url, 'video', 'video/mp4');
  }
}

export function primeLookAssets(rows: Look[]): void {
  if (!rows?.length) return;

  for (const row of rows.slice(0, POSTERS_TO_WARM)) {
    // Mirror CreativeCardV2's look-poster fallback EXACTLY (thumbnail → cover →
    // first product image) so the warmed URL is the same one the card renders.
    // ~60% of feed looks have no thumbnail_url and now poster off a product
    // image; warming only thumbnail/cover left those cold, so they painted
    // black for the download window when scrolled into view or on overlay
    // return. Warming the product-image fallback makes them a cache hit.
    const rawPoster = lookPoster(row);
    if (!rawPoster) continue;
    const poster = posterRendition(rawPoster) || rawPoster;
    if (warmedPosters.has(poster)) continue;
    warmedPosters.add(poster);
    injectPreload(poster, 'image');
    void decodeImage(poster);
  }

  if (!networkLooksHealthy()) return;
  let hlsHeads = 0;
  for (const row of rows.slice(0, VIDEOS_TO_WARM)) {
    // HLS-aware: when the pipeline dial is on 'hls' and a look ships the
    // adaptive ladder (hls_url), that's the source LookCard/CreativeCardV2
    // actually play — warm its head (manifest + lowest-rung init + first
    // segments) so hls.js attaches to a cache hit. A full-file
    // <link rel=preload as=video> on the MP4 here would download bytes the
    // player never reads AND steal bandwidth from the HLS segment fetch.
    // In 'mp4' mode fall through to the progressive warm below. Capped to
    // HLS_HEADS_TO_WARM so the synchronous batch doesn't thrash the bounded
    // head-warm queue and evict the nearest cards.
    if (videoPipelineMode() === 'hls' && row.hls_url) {
      if (hlsHeads < HLS_HEADS_TO_WARM) { prefetchHlsHead(row.hls_url); hlsHeads++; }
      continue;
    }
    const url = row.mobile_video_url || row.video;
    if (!url || warmedVideos.has(url)) continue;
    warmedVideos.add(url);
    injectPreload(url, 'video', 'video/mp4');
  }
}

export function clearTrailPrefetchCache(): void {
  warmedPosters.clear();
  warmedVideos.clear();
}
