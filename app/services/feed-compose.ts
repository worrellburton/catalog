// Pure feed-ordering composition, extracted from ContinuousFeed so the
// final ranking decision is unit-testable without mounting the component or
// mocking Supabase. No React, no I/O — given the resolved candidate lists it
// returns the exact order the grid renders.
//
// The ordering contract (priority, highest first):
//   1. Brand fast-path  — exact brand intent, dedup by id AND product_id.
//   2. Active search     — the semantic ranker (search_products: in-category,
//                          color / subcategory / relevance aware) is the SOLE
//                          authority; its order is returned VERBATIM. The
//                          tier-1 catalog_tags match (tagMatch) is INSTANT-PAINT
//                          ONLY — it renders for the ~100ms before the edge
//                          function resolves, then V8 replaces it.
//   3. Home feed         — query-agnostic personalization (seen-partition →
//                          affinity lean → Automatic Editor order).
//
// Two rules are load-bearing:
//   * ONE ranker for every search. Single-word category queries ("shoes")
//     used to be served by the color-blind client tier-1 path while
//     multi-word ones ("black shoes") went to V8 — two brains, divergent
//     ranking. Now every >=3-char query is authoritative on V8; tier-1 is
//     just the loading placeholder. V8's category route hard-filters to the
//     category (no dense-neighbour drift) and unions type OR taxonomy so it
//     has BETTER recall than tier-1's type-only synonym list.
//   * Personalization (rule 3) must NEVER reorder an explicit search. It
//     floats globally-popular products to the front regardless of the query,
//     which silently overrode the server ranking — e.g. "black shoes"
//     surfaced white sneakers. See feed-compose.test.ts for the guards.

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

  // 2. Active explicit search → the V8 semantic ranker is the SOLE authority,
  //    returned VERBATIM. tier-1 (tagMatch) is instant-paint only: it renders
  //    until the edge function resolves, then V8 replaces it. Personalization
  //    is query-agnostic and must not reorder a deliberate search.
  if (q.length >= 3) {
    return a.semanticOrdered.length > 0 ? a.semanticOrdered : dedupById(a.tagMatch);
  }

  // 3. Home feed → personalize: hide already-seen products, softly lean toward
  //    favoured categories, then float the Automatic Editor's per-shopper order
  //    to the front (rest keep their existing order).
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
