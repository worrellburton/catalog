// Pure feed-ordering composition, extracted from ContinuousFeed so the
// final ranking decision is unit-testable without mounting the component or
// mocking Supabase. No React, no I/O — given the resolved candidate lists it
// returns the exact order the grid renders.
//
// The ordering contract (priority, highest first):
//   1. Brand fast-path  — exact brand intent, dedup by id AND product_id.
//   2. Active search     — the semantic ranker (search_products: color /
//                          subcategory / relevance aware) is the SOLE
//                          authority; its order is returned VERBATIM.
//   3. Home feed         — query-agnostic personalization (seen-partition →
//                          affinity lean → Automatic Editor order).
//   4. Tier-1 tag match  — typed-category creatives, dedup by id.
//
// Rule (2) is load-bearing: personalization (rule 3) must NEVER reorder an
// explicit search. It floats globally-popular products to the front
// regardless of the query, which silently overrode the server ranking — e.g.
// "black shoes" surfaced white sneakers because they out-rank in the
// personalized order. See feed-compose.test.ts for the regression guard.

import type { ProductAd } from '~/services/product-creative';
import type { UserAffinity } from '~/services/user-affinity';
import { rankCreativesByAffinity } from '~/services/user-affinity';
import { partitionUnseen, type SeenKey } from '~/services/seen-feed';

export interface ComposeRenderedArgs {
  /** The committed (resolved) search query — empty string on the home feed. */
  committedQuery: string;
  /** Brand fast-path creatives resolved for the committed query (or []). */
  brandMatch: ProductAd[];
  /** Tier-1 catalog_tags creatives resolved for the committed query (or []). */
  tagMatch: ProductAd[];
  /** Semantic (search_products) results in ranker order, already video-filtered. */
  semanticOrdered: ProductAd[];
  /** Seen-key set for the home-feed unseen partition. */
  seenKeys: Set<SeenKey>;
  /** Shopper category affinity for the home-feed soft re-rank. */
  affinity: UserAffinity;
  /** Automatic Editor per-shopper product order (null = off / guest / holdout). */
  personalizedOrder: string[] | null;
}

function dedupById(items: ProductAd[]): ProductAd[] {
  const seen = new Set<string>();
  const out: ProductAd[] = [];
  for (const c of items) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

export function composeRenderedCreatives(a: ComposeRenderedArgs): ProductAd[] {
  const q = a.committedQuery.trim().toLowerCase();

  // 1. Brand fast-path — intent is unambiguous; dedup by id AND product_id so
  //    multiple creatives for one product collapse to a single tile.
  if (a.brandMatch.length > 0) {
    const seen = new Set<string>();
    const seenProducts = new Set<string>();
    const out: ProductAd[] = [];
    for (const c of a.brandMatch) {
      if (seen.has(c.id)) continue;
      if (c.product_id && seenProducts.has(c.product_id)) continue;
      seen.add(c.id);
      if (c.product_id) seenProducts.add(c.product_id);
      out.push(c);
    }
    return out;
  }

  // 2. Active explicit search → semantic ranker order, VERBATIM. Personalization
  //    is query-agnostic and must not reorder a deliberate search.
  if (q.length >= 3 && a.tagMatch.length === 0) {
    return a.semanticOrdered;
  }

  // 3. Home feed (no typed/tag match) → personalize: hide already-seen products,
  //    softly lean toward favoured categories, then float the Automatic Editor's
  //    per-shopper order to the front (rest keep their existing order).
  if (a.tagMatch.length === 0) {
    const unseen = partitionUnseen(a.semanticOrdered, a.seenKeys, c => (c.product_id ? `product:${c.product_id}` : null));
    const ranked = rankCreativesByAffinity(unseen, a.affinity);
    if (a.personalizedOrder && a.personalizedOrder.length > 0) {
      const priority = new Map(a.personalizedOrder.map((id, idx) => [id, idx]));
      const front: ProductAd[] = [];
      const rest: ProductAd[] = [];
      for (const c of ranked) {
        if (c.product_id && priority.has(c.product_id)) front.push(c);
        else rest.push(c);
      }
      front.sort((x, y) => (priority.get(x.product_id!) ?? 0) - (priority.get(y.product_id!) ?? 0));
      return [...front, ...rest];
    }
    return ranked;
  }

  // 4. Tier-1 typed match → those exclusively.
  return dedupById(a.tagMatch);
}
