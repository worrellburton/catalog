// Single source of truth for "what image / video do I show for this look or
// product?". Before this module the poster fallback chain was reimplemented in
// ~6 components with subtly different orders — and every drift between them
// produced a black-screen regression (feed → product page, look overlay hero,
// inline look detail, the feed→product image hand-off). Resolve it in ONE place
// so the surfaces can't disagree.
//
// Video-URL picking already lives in services/video-loading (pickVideoUrl etc.);
// we re-export those here too so callers have a single media-resolution import.

import type { Look, Product } from '~/data/looks';
import {
  pickVideoUrl,
  pickPosterUrl,
  pickStillImageUrl,
} from '~/services/video-loading';

// Re-exported so new code imports all media resolution from one place.
//   creativeVideo / creativePoster / creativeStill operate on a ProductAd
//   ("creative") — the feed-card / product-creative shape.
export {
  pickVideoUrl as creativeVideo,
  pickPosterUrl as creativePoster,
  pickStillImageUrl as creativeStill,
};

/** The first product image attached to a look — the last-resort poster so a
 *  look that has no generated frame yet never paints pure black while its clip
 *  buffers. */
function firstLookProductImage(look: Pick<Look, 'products'>): string {
  return look.products?.find((p) => !!p.image)?.image || '';
}

/**
 * Canonical poster for a LOOK — the still painted before/behind the look video
 * on every surface (feed card, overlay hero, inline detail, look tiles).
 *
 * Order: the look's own generated frame (thumbnail_url) → a static cover →
 * a product packshot. The product fallback exists ONLY so a posterless look is
 * never black; once the poster pipeline has run, thumbnail_url always wins.
 *
 * `ownOnly` drops the product-packshot fallback — for surfaces that must show
 * the LOOK itself (its frame / video) and never a product image, e.g. the
 * creator catalog, where a posterless generated look should reveal its own
 * video frame rather than borrowing a product packshot.
 */
export function lookPoster(
  look: Pick<Look, 'thumbnail_url' | 'cover' | 'products'>,
  ownOnly = false,
): string {
  return look.thumbnail_url || look.cover || (ownOnly ? '' : firstLookProductImage(look)) || '';
}

/**
 * Canonical poster for a PRODUCT (the Product shape from data/looks, used by
 * the product page hero and the look's product rows). The polished primary
 * image wins; the video poster is the fallback.
 */
export function productPoster(
  p: Pick<Product, 'image' | 'thumbnail_url'>,
): string {
  return p.image || p.thumbnail_url || '';
}
