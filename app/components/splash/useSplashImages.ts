// Pulls a small set of hard-downscaled image URLs from the cached home
// feed for the splash to animate. ~80px @ q40 → a few KB each, so the
// whole splash payload is tiny even with 24 tiles.

import { useMemo } from 'react';
import { getCachedHomeFeed } from '~/services/product-creative';
import { withTransform } from '~/utils/supabase-image';

export const SPLASH_MAX_IMAGES = 24;

export function useSplashImages(limit: number = SPLASH_MAX_IMAGES): string[] {
  return useMemo(() => {
    const feed = getCachedHomeFeed() ?? [];
    const urls: string[] = [];
    const seen = new Set<string>();
    for (const ad of feed) {
      const raw =
        ad.product?.primary_image_url ||
        ad.thumbnail_url ||
        ad.product?.image_url ||
        (ad.product?.images && ad.product.images[0]) ||
        null;
      if (!raw || seen.has(raw)) continue;
      seen.add(raw);
      const small = withTransform(raw, { width: 80, quality: 40, resize: 'cover' }) || raw;
      urls.push(small);
      if (urls.length >= limit) break;
    }
    return urls;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);
}

/** Deterministic pseudo-random in [0,1) — stable per (index, salt) so a
 *  variant's layout doesn't reshuffle on re-render within one play. */
export function seeded(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}
