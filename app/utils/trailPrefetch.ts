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
import { withTransform } from './supabase-image';
import { pickPosterUrl } from '~/services/video-loading';

const POSTERS_TO_WARM = 16;
// Warm the first ~2 viewports of cards. At ~6 cards per mobile viewport
// that's 12; bumping to 18 covers fast-scrollers who blow past the
// initial set before the in-page IntersectionObserver has time to trigger
// the regular preload chain.
const VIDEOS_TO_WARM = 18;

// Match CreativeCardV2's poster transform EXACTLY (same width/quality/resize
// AND the pickPosterUrl source) so the warmed URL is a byte-for-byte cache hit
// when the card mounts. A mismatch means the prefetch downloads one variant and
// the card downloads another — double the bytes, zero benefit.
const POSTER_TRANSFORM = { width: 540, quality: 72, resize: 'contain' as const };

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
    const poster = withTransform(rawPoster, POSTER_TRANSFORM) || rawPoster;
    if (warmedPosters.has(poster)) continue;
    warmedPosters.add(poster);
    injectPreload(poster, 'image');
    void decodeImage(poster);
  }

  // Video warm: gated. The hero loop on the first card matters most for the
  // "no black flash" feel, so prioritize the top three and stop.
  if (!networkLooksHealthy()) return;
  for (const row of rows.slice(0, VIDEOS_TO_WARM)) {
    const url = row.video_url;
    if (!url || warmedVideos.has(url)) continue;
    warmedVideos.add(url);
    injectPreload(url, 'video', 'video/mp4');
  }
}

export function primeLookAssets(rows: Look[]): void {
  if (!rows?.length) return;

  for (const row of rows.slice(0, POSTERS_TO_WARM)) {
    const rawPoster = row.thumbnail_url || row.cover;
    if (!rawPoster) continue;
    const poster = withTransform(rawPoster, POSTER_TRANSFORM) || rawPoster;
    if (warmedPosters.has(poster)) continue;
    warmedPosters.add(poster);
    injectPreload(poster, 'image');
    void decodeImage(poster);
  }

  if (!networkLooksHealthy()) return;
  for (const row of rows.slice(0, VIDEOS_TO_WARM)) {
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
