// trailPrefetch — warm browser caches for the consumer feed before the user
// gets there. Two layers:
//
//   1. Posters (cheap, universally good): inject <link rel="preload" as="image">
//      for the first ~12 thumbnails and force a decode pass so they paint
//      instantly when the cards render.
//   2. Videos (expensive, network-gated): inject <link rel="preload" as="video">
//      for the first 3 only when the connection looks healthy and the user
//      hasn't enabled Save Data.
//
// Idempotent — calling twice with the same rows is a no-op.

import type { ProductAd } from '~/services/product-creative';

const POSTERS_TO_WARM = 12;
const VIDEOS_TO_WARM = 3;

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
  if (!conn) return true; // Browser doesn't expose Network Info — assume good.
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

  // Poster warm: only need a thumbnail for the first ~12 cards above-the-fold.
  for (const row of rows.slice(0, POSTERS_TO_WARM)) {
    const poster = row.thumbnail_url || row.product?.image_url;
    if (!poster || warmedPosters.has(poster)) continue;
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

export function clearTrailPrefetchCache(): void {
  warmedPosters.clear();
  warmedVideos.clear();
}
