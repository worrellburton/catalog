// feed-why-shopper — the SHOPPER-facing sibling of feed-why. Where
// feed-why produces the super-admin debug panel (lazy-loaded, verbose),
// this produces at most one short trust caption per card ("Because you
// saved Nike"). Deliberately tiny and dependency-free (type-only imports)
// so it can ship in the main bundle without dragging the explainer in.

import type { ProductAd } from '~/services/product-creative';
import type { Look } from '~/data/looks';
import type { FeedWhyContextData } from '~/services/feed-why';

/** Only the strongest personalized picks get the caption — captioning
 *  every card would turn a trust signal into wallpaper. */
const PERSONALIZED_CAPTION_DEPTH = 12;

const titleCase = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase());

/**
 * A one-line "why you're seeing this" for shoppers, or null when there's
 * no personal signal worth surfacing. Home feed only — during an active
 * search the reason is self-evident (it matched the query), so we stay
 * quiet rather than captioning every result.
 */
export function shopperWhyLabel(
  input: { creative?: ProductAd; look?: Look },
  ctx: FeedWhyContextData,
): string | null {
  if (ctx.committedQuery.trim().length >= 3) return null;

  const { creative } = input;
  if (!creative) return null; // look captions add noise without a clear signal
  const p = creative.product;

  const rank = creative.product_id ? ctx.personalizedRank.get(creative.product_id) : undefined;
  if (rank != null && rank < PERSONALIZED_CAPTION_DEPTH) return 'Picked for you today';

  const brand = p?.brand ?? '';
  if (brand && ctx.savedBrands.has(brand.toLowerCase())) return `Because you saved ${brand}`;

  const type = (p?.type ?? '').toString();
  if (type && ctx.affinityTopTypes.includes(type.toLowerCase())) {
    return `Because you shop ${titleCase(type)}`;
  }

  return null;
}
