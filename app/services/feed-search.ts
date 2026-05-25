// Shared helper that replicates the consumer feed's search result pipeline
// so admin surfaces can show the same creatives a user sees when searching a
// term (e.g. catalog name) in the feed search bar.
//
// Mirrors ContinuousFeed's renderedCreatives precedence:
//   1. Brand fast-path (exact brand match → only that brand's creatives)
//   2. Tier-1 catalog_tags / product.type match
//   3. Semantic search (server-side `search` edge function)
//
// Deduped by id, and (for the brand lane) also by product_id, the same way
// the feed does it. Returns the merged `ProductAd[]` list ready for render.

import {
  getCreativesByBrandQuery,
  getCreativesByCatalogTag,
  getCreativesByProductIds,
  type ProductAd,
} from './product-creative';
import { search, type SemanticCreative } from './search';
import { supabase } from '~/utils/supabase';

function semanticToProductAd(c: SemanticCreative): ProductAd {
  return {
    id:               c.id,
    product_id:       c.product_id,
    look_id:          null,
    title:            null,
    description:      null,
    video_url:        c.video_url,
    mobile_video_url: null,
    storage_path:     null,
    thumbnail_url:    c.thumbnail_url,
    affiliate_url:    c.affiliate_url,
    prompt:           null,
    prompt_extra:     null,
    style:            'semantic',
    model:            null,
    status:           'live',
    duration_seconds: c.duration_seconds,
    aspect_ratio:     null,
    resolution:       null,
    cost_usd:         null,
    impressions:      0,
    clicks:           0,
    error:            null,
    enabled:          true,
    is_elite:         c.is_elite ?? false,
    created_at:       new Date().toISOString(),
    completed_at:     null,
    updated_at:       null,
    product: {
      id:           c.product_id,
      name:         c.product_name,
      brand:        c.product_brand,
      price:        c.product_price,
      image_url:    c.product_image_url,
      url:          c.product_url,
      catalog_tags: null,
    },
  };
}

/**
 * Fetch the creative list that the consumer feed would render for the given
 * search query. Returns up to `limit` deduped `ProductAd` rows. Returns []
 * on empty / failed lookups - callers should treat empty as "no results".
 */
export async function getFeedSearchResults(query: string, limit = 60): Promise<ProductAd[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // 1. Brand fast-path
  try {
    const brandHits = await getCreativesByBrandQuery(trimmed, limit);
    if (brandHits && brandHits.length > 0) {
      const seen = new Set<string>();
      const seenProducts = new Set<string>();
      const out: ProductAd[] = [];
      for (const c of brandHits) {
        if (seen.has(c.id)) continue;
        if (c.product_id && seenProducts.has(c.product_id)) continue;
        seen.add(c.id);
        if (c.product_id) seenProducts.add(c.product_id);
        out.push(c);
      }
      return out;
    }
  } catch (err) {
    console.warn('[getFeedSearchResults] brand lane failed:', err);
  }

  // 2. Tier-1 catalog_tags / type match
  try {
    const tagHits = await getCreativesByCatalogTag(trimmed);
    if (tagHits.length > 0) {
      const seen = new Set<string>();
      const out: ProductAd[] = [];
      for (const c of tagHits) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(c);
      }
      return out;
    }
  } catch (err) {
    console.warn('[getFeedSearchResults] tag lane failed:', err);
  }

  // 3. Semantic search
  try {
    const res = await search(trimmed, { k: limit });
    if (!res.ok || res.results.length === 0) return [];

    // Map the semantic hits directly. For placeholder rows (no creative yet),
    // try to hydrate a real creative via getCreativesByProductIds so the admin
    // view doesn't render image stand-ins like the consumer feed filters out.
    const placeholderProductIds: string[] = [];
    const semanticAds: ProductAd[] = [];
    for (const r of res.results) {
      if (r.is_placeholder || !r.video_url) {
        if (r.product_id) placeholderProductIds.push(r.product_id);
      } else {
        semanticAds.push(semanticToProductAd(r));
      }
    }

    let hydrated: ProductAd[] = [];
    if (placeholderProductIds.length > 0) {
      try {
        hydrated = await getCreativesByProductIds(placeholderProductIds);
      } catch (err) {
        console.warn('[getFeedSearchResults] hydrate placeholders failed:', err);
      }
    }

    const seen = new Set<string>();
    const seenProducts = new Set<string>();
    const out: ProductAd[] = [];
    for (const c of [...semanticAds, ...hydrated]) {
      if (seen.has(c.id)) continue;
      if (c.product_id && seenProducts.has(c.product_id)) continue;
      seen.add(c.id);
      if (c.product_id) seenProducts.add(c.product_id);
      out.push(c);
    }
    return out.slice(0, limit);
  } catch (err) {
    console.warn('[getFeedSearchResults] semantic lane failed:', err);
    return [];
  }
}

// ── Bundle: creatives + products + looks ─────────────────────────────────
// Used by admin surfaces that need all three content types for a query, e.g.
// the per-catalog detail page's "Feed search results" section.

export interface FeedProduct {
  id: string;
  name: string | null;
  brand: string | null;
  price: string | null;
  image_url: string | null;
  url: string | null;
  gender: string | null;
  catalog_tags: string[] | null;
}

export interface FeedLook {
  id: string;
  title: string;
  videoPath: string | null;
  creatorHandle: string | null;
  productCount: number;
}

export interface FeedSearchBundle {
  creatives: ProductAd[];
  products: FeedProduct[];
  looks: FeedLook[];
}

export async function getFeedSearchBundle(query: string, limit = 60): Promise<FeedSearchBundle> {
  const trimmed = query.trim();
  if (!trimmed || !supabase) return { creatives: [], products: [], looks: [] };

  const [creatives, products, looks] = await Promise.all([
    getFeedSearchResults(trimmed, limit).catch(() => [] as ProductAd[]),

    // Products: catalog_tags contains the query (mirrors tier-1 lane), ordered
    // by conversion_score so the best performers surface first.
    supabase
      .from('products')
      .select('id, name, brand, price, image_url, url, gender, catalog_tags')
      .contains('catalog_tags', [trimmed])
      .eq('is_active', true)
      .order('conversion_score', { ascending: false })
      .limit(limit)
      .then(({ data }) => (data ?? []) as FeedProduct[], () => [] as FeedProduct[]),

    // Looks: catalog_tags contains the query.
    supabase
      .from('looks')
      .select(`
        id, title, creator_handle, status, enabled, archived_at,
        looks_creative!inner ( video_url, is_primary ),
        look_products ( product_id )
      `)
      .contains('catalog_tags', [trimmed])
      .eq('status', 'live')
      .eq('enabled', true)
      .is('archived_at', null)
      .eq('looks_creative.is_primary', true)
      .limit(limit)
      .then(({ data }) => {
        if (!data) return [] as FeedLook[];
        return (data as {
          id: string;
          title: string;
          creator_handle: string | null;
          looks_creative: { video_url: string | null }[];
          look_products: { product_id: string }[];
        }[]).map(r => ({
          id: r.id,
          title: r.title,
          videoPath: r.looks_creative?.[0]?.video_url ?? null,
          creatorHandle: r.creator_handle,
          productCount: (r.look_products ?? []).length,
        }));
      }, () => [] as FeedLook[]),
  ]);

  return { creatives, products, looks };
}
