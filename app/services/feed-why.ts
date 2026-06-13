// feed-why — the super-admin "why did this show up?" explainer. Pure and
// lazy-loaded (only pulled when a super-admin actually taps the debug
// button on a card), so it costs normal shoppers nothing.
//
// It mirrors the exact precedence in feed-compose.composeRenderedCreatives
// and ContinuousFeed's look ranking, reconstructing — from the same
// resolved inputs the feed used — which lane placed a given card and why.

import type { ProductAd } from '~/services/product-creative';
import type { Look } from '~/data/looks';

/** Snapshot of the live feed state, captured by ContinuousFeed and read
 *  on demand. All sets/maps are keyed exactly as the feed composes them. */
export interface FeedWhyContextData {
  committedQuery: string;
  /** Brand fast-path engaged (brandMatch non-empty) — then every rendered
   *  product is an exact-brand result. */
  brandActive: boolean;
  /** product-creative ids in the tier-1 catalog_tags match. */
  tagIds: Set<string>;
  /** product-creative id → 0-based rank in the semantic (V8) results. */
  semanticRank: Map<string, number>;
  /** Lowercased product types the affinity model currently favours. */
  affinityTopTypes: string[];
  /** product_id → 0-based rank in the Automatic Editor's per-shopper order. */
  personalizedRank: Map<string, number>;
  /** Lowercased brands boosted by the "saved brands" home rule. */
  savedBrands: Set<string>;
  /** product_ids the shopper has already been shown (unseen-partition). */
  seenProductIds: Set<string>;
  /** Look uuids that matched the active search. */
  lookSearchUuids: Set<string>;
  /** Lowercased product types favoured for the look lane. */
  lookAffinityTopTypes: string[];
}

export type WhyTone = 'search' | 'brand' | 'tag' | 'personalized' | 'affinity' | 'saved' | 'fresh' | 'default';

export interface FeedWhy {
  tone: WhyTone;
  lane: string;
  headline: string;
  detail: string;
  facts: Array<{ label: string; value: string }>;
}

const titleCase = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase());

export function explainCreative(c: ProductAd, ctx: FeedWhyContextData): FeedWhy {
  const q = ctx.committedQuery.trim();
  const p = c.product ?? null;
  const brand = p?.brand ?? '—';
  const type = (p?.type ?? '').toString();
  const facts: FeedWhy['facts'] = [
    { label: 'Product', value: p?.name ?? '—' },
    { label: 'Brand', value: brand },
    { label: 'Type', value: type || '—' },
    { label: 'Gender', value: (p?.gender ?? 'unisex').toString() },
  ];
  if (c.is_elite) facts.push({ label: 'Elite', value: 'yes' });
  if (q) facts.push({ label: 'Your search', value: `"${q}"` });

  // 1 — brand fast-path
  if (ctx.brandActive) {
    return {
      tone: 'brand', lane: 'Brand match',
      headline: `Exact brand match for "${q}"`,
      detail: `You searched a brand name, so the feed shows only ${brand}'s products — the semantic ranker is skipped because the intent is unambiguous.`,
      facts,
    };
  }

  // 2 — active explicit search (≥3 chars): semantic is authoritative
  if (q.length >= 3) {
    const rank = ctx.semanticRank.get(c.id);
    if (rank != null) {
      return {
        tone: 'search', lane: 'Semantic search',
        headline: `Ranked #${rank + 1} for "${q}"`,
        detail: `The V8 semantic ranker placed this here — gte-small embeddings on name/brand/type/description, blended with BM25 keyword score via reciprocal-rank fusion, hard-filtered to the query's category and your gender.`,
        facts: [...facts, { label: 'Semantic rank', value: `#${rank + 1}` }],
      };
    }
    if (ctx.tagIds.has(c.id)) {
      return {
        tone: 'tag', lane: 'Catalog-tag match',
        headline: `Instant tag match for "${q}"`,
        detail: `This is the tier-1 catalog_tags match that paints instantly while the semantic ranker resolves — it'll be replaced by the V8 order once that lands.`,
        facts,
      };
    }
    return {
      tone: 'default', lane: 'Search results',
      headline: `In the results for "${q}"`,
      detail: `Part of the result set for this query.`,
      facts,
    };
  }

  // 3 — home feed: layered personalization
  const factors: string[] = [];
  const editorRank = c.product_id ? ctx.personalizedRank.get(c.product_id) : undefined;
  const savedHit = !!p?.brand && ctx.savedBrands.has(p.brand.toLowerCase());
  const affinityHit = !!type && ctx.affinityTopTypes.includes(type.toLowerCase());
  const fresh = !!c.product_id && !ctx.seenProductIds.has(c.product_id);
  if (editorRank != null) factors.push(`Automatic Editor pick #${editorRank + 1}`);
  if (savedHit) factors.push('brand you saved');
  if (affinityHit) factors.push(`${type} is a category you lean toward`);
  factors.push(fresh ? 'not shown to you before' : 'shown to you before');
  if (factors.length) facts.push({ label: 'Signals', value: factors.join(' · ') });

  if (editorRank != null) {
    return {
      tone: 'personalized', lane: 'Automatic Editor',
      headline: `Editor's pick #${editorRank + 1} for you`,
      detail: `The Automatic Editor (Claude re-ranking your top candidates daily) floated this to the front of your personal home feed.`,
      facts,
    };
  }
  if (savedHit) {
    return {
      tone: 'saved', lane: 'Saved-brand boost',
      headline: `Boosted: you saved ${brand}`,
      detail: `The "boost saved brands" home rule lifts products from brands in your bookmarks up the feed. Never applies to searches.`,
      facts,
    };
  }
  if (affinityHit) {
    return {
      tone: 'affinity', lane: 'Category affinity',
      headline: `You lean toward ${titleCase(type)}`,
      detail: `Your on-device affinity model (what you search, open and save) softly re-ranked this category up on the home feed.`,
      facts,
    };
  }
  if (fresh) {
    return {
      tone: 'fresh', lane: 'Fresh',
      headline: `New to you`,
      detail: `The home feed partitions products you haven't seen to the top, so unseen inventory leads before anything repeats.`,
      facts,
    };
  }
  return {
    tone: 'default', lane: 'Home feed',
    headline: `Editorial home order`,
    detail: `No search or strong personal signal — this sits in the admin's unified feed_rank (the /admin/catalogs FEED arrangement).`,
    facts,
  };
}

export function explainLook(l: Look, ctx: FeedWhyContextData): FeedWhy {
  const q = ctx.committedQuery.trim();
  const facts: FeedWhy['facts'] = [
    { label: 'Look', value: l.title || l.id?.toString() || '—' },
    { label: 'Creator', value: l.creatorDisplayName || l.creator || '—' },
    { label: 'Gender', value: (l.gender ?? 'unisex').toString() },
    { label: 'Products', value: String(l.products?.length ?? 0) },
  ];
  if (q) facts.push({ label: 'Your search', value: `"${q}"` });

  if (q.length >= 3) {
    const matched = (l.uuid && ctx.lookSearchUuids.has(l.uuid)) || (l.id != null && ctx.lookSearchUuids.has(String(l.id)));
    return matched
      ? { tone: 'search', lane: 'Semantic search', headline: `Look matched "${q}"`, detail: `The look semantic ranker matched this look's products/description to your query, then it was woven into the product results.`, facts }
      : { tone: 'default', lane: 'Search results', headline: `In the results for "${q}"`, detail: `Surfaced alongside the product results for this query.`, facts };
  }
  return {
    tone: 'default', lane: 'Home feed',
    headline: `Creator look in your feed`,
    detail: `Looks are woven into the home feed by the unified feed_rank, with at least one look pulled to the top so creator content always leads.`,
    facts,
  };
}
