// Pulls splash media from the cached home feed.
//
// Images: we prefer the brand's own CDN packshot (`product.image_url` /
// `images[0]`) — clean studio product photos — over `primary_image_url`
// /`thumbnail_url`, which are the AI-generated video SOURCE stills (blurry,
// oddly-cropped frames). Those stills were the "messed up" tiles. We size
// them at 240px (crisp on a splash tile) instead of the old 80px.
//
// Videos: every feed product also has `primary_video_url` (the same i2v
// clip the live feed plays). We expose a small capped set so variants can
// render a few LIVE tiles, each paired with a clean still as its poster so
// it shows the product image until the clip buffers.

import { useMemo } from 'react';
import { getCachedHomeFeed } from '~/services/product-creative';
import { withTransform } from '~/utils/supabase-image';
import type { SplashVideo } from './types';

export const SPLASH_MAX_IMAGES = 24;
export const SPLASH_MAX_VIDEOS = 6;

export interface SplashMedia {
  images: string[];
  videos: SplashVideo[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cleanImageUrl(ad: any): string | null {
  const raw =
    ad.product?.image_url ||
    (ad.product?.images && ad.product.images[0]) ||
    ad.product?.primary_image_url ||
    ad.thumbnail_url ||
    null;
  if (!raw) return null;
  // No-op for external brand CDN URLs (already optimized); crops Supabase
  // storage stills to a crisp 240px.
  return withTransform(raw, { width: 240, quality: 60, resize: 'cover' }) || raw;
}

export function useSplashMedia(limit: number = SPLASH_MAX_IMAGES): SplashMedia {
  return useMemo(() => {
    const feed = getCachedHomeFeed() ?? [];
    const images: string[] = [];
    const videos: SplashVideo[] = [];
    const seenImg = new Set<string>();
    const seenVid = new Set<string>();
    for (const ad of feed) {
      const img = cleanImageUrl(ad);
      if (img && !seenImg.has(img)) { seenImg.add(img); images.push(img); }

      const vid = ad.product?.primary_video_url || ad.video_url || null;
      if (vid && !seenVid.has(vid) && videos.length < SPLASH_MAX_VIDEOS) {
        seenVid.add(vid);
        videos.push({ src: vid, poster: img || '' });
      }
      if (images.length >= limit && videos.length >= SPLASH_MAX_VIDEOS) break;
    }
    return { images: images.slice(0, limit), videos };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);
}

/** Images-only convenience (back-compat for variants that ignore video). */
export function useSplashImages(limit: number = SPLASH_MAX_IMAGES): string[] {
  return useSplashMedia(limit).images;
}

/** Deterministic pseudo-random in [0,1) — stable per (index, salt) so a
 *  variant's layout doesn't reshuffle on re-render within one play. */
export function seeded(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}
