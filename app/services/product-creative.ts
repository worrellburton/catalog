import { supabase } from '~/utils/supabase';

// Module-level shopper gender. Consumer routes call setShopperGender
// once after auth resolves so every product-creative query (brand
// strip, similar rail, live ads) can scope to male+unisex / female+
// unisex without each caller threading the gender prop through.
// 'unknown' (the default) disables filtering — we never hide the
// catalog from someone we can't tag.
type ShopperGender = 'male' | 'female' | 'unknown';
let shopperGender: ShopperGender = 'unknown';
export function setShopperGender(g: ShopperGender) {
  if (g === shopperGender) return;
  shopperGender = g;
  // Drop caches so the next callers re-fetch with the new scope.
  liveAdsPromise = null;
  brandCache.clear();
  similarCache.clear();
}

/** Returns the genders we should accept for the current shopper. */
function visibleGenders(): Array<'male' | 'female' | 'unisex'> | null {
  if (shopperGender === 'male') return ['male', 'unisex'];
  if (shopperGender === 'female') return ['female', 'unisex'];
  return null; // 'unknown' → no filter
}

/** Post-filter products by the shopper's gender. Untagged products
 *  (gender is null) stay visible to everyone. */
function passesGenderFilter(p: { gender?: string | null } | null | undefined): boolean {
  if (!p) return true;
  if (shopperGender === 'unknown') return true;
  const g = p.gender;
  if (!g) return true; // untagged
  if (g === 'unisex') return true;
  if (shopperGender === 'male') return g === 'male';
  if (shopperGender === 'female') return g === 'female';
  return true;
}

export interface ProductAd {
  id: string;
  product_id: string;
  look_id: string | null;
  title: string | null;
  description: string | null;
  video_url: string | null;
  storage_path: string | null;
  thumbnail_url: string | null;
  affiliate_url: string | null;
  prompt: string | null;
  prompt_extra: string | null;
  style: string;
  model: string | null;
  status: 'queued' | 'pending' | 'generating' | 'done' | 'failed' | 'live' | 'paused';
  duration_seconds: number | null;
  aspect_ratio: string | null;
  resolution: string | null;
  cost_usd: number | null;
  impressions: number;
  clicks: number;
  error: string | null;
  enabled: boolean;
  is_elite?: boolean;
  created_at: string;
  completed_at: string | null;
  updated_at: string | null;
  // joined
  product?: { id: string; name: string | null; brand: string | null; price: string | null; image_url: string | null; images?: string[] | null; url: string | null; catalog_tags?: string[] | null; is_elite?: boolean };
}

export interface CreateAdRequest {
  product_id: string;
  style: string;
  affiliate_url?: string;
}

const AD_SELECT = `
  *,
  product:products(id, name, brand, price, image_url, images, url, type, catalog_tags, is_active, is_elite, gender)
`;

export async function getProductAds(): Promise<ProductAd[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('product_creative')
    .select(AD_SELECT)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('Failed to load product creatives:', error.message);
    return [];
  }
  return (data || []) as ProductAd[];
}

export async function getProductAdsByStatus(status: string): Promise<ProductAd[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('product_creative')
    .select(AD_SELECT)
    .eq('status', status)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('Failed to load product creatives:', error.message);
    return [];
  }
  return (data || []) as ProductAd[];
}

export async function getLiveAds(): Promise<ProductAd[]> {
  if (!supabase) return [];
  // Only surface explicitly approved (status='live') creatives in the consumer feed.
  // New creatives land at 'done' and must pass through the moderation queue first.
  // Boosted ads (boosted_until > now) sort to the top.
  // Also respect the product.is_active toggle — deactivating a product
  // should immediately pull its creatives off the feed without requiring the
  // admin to individually pause each one.
  // is_elite gate: the consumer feed is now curated — only hand-picked
  // creatives from the admin Creative view appear in the grid.
  const { data, error } = await supabase
    .from('product_creative')
    .select(`
      *,
      product:products(id, name, brand, price, image_url, images, url, catalog_tags, is_active, is_elite, gender)
    `)
    .eq('status', 'live')
    .eq('is_elite', true)
    .not('video_url', 'is', null)
    .order('boosted_until', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[getLiveAds] query error:', error.message);
    return [];
  }
  const rows = (data || []) as ProductAd[];
  return rows.filter(ad => {
    // When the join returned a product row, it must be active. If the join
    // was filtered out (product deleted), keep the ad — the client-side
    // admin_hidden_products filter handles that case.
    const active = (ad.product as { is_active?: boolean } | null | undefined)?.is_active;
    if (active === false) return false;
    return passesGenderFilter(ad.product as { gender?: string | null } | null);
  });
}

// ── Trail prefetch ────────────────────────────────────────────────────────
// The landing screen primes this so the consumer feed is already in memory
// (and its assets are warming) by the time the user signs in.
//
// We cache the in-flight Promise itself, not the resolved value, so multiple
// concurrent callers (LandingPage + ContinuousFeed mount races) coalesce onto
// a single network request. After it resolves, every caller awaits the same
// already-resolved Promise — effectively instant.
//
// Stale-while-revalidate: invalidate() clears the cache so the next caller
// kicks off a fresh fetch (used after admin actions).
let liveAdsPromise: Promise<ProductAd[]> | null = null;
let liveAdsFetchedAt = 0;
const LIVE_ADS_TTL_MS = 60_000;

export function prefetchLiveAds(): Promise<ProductAd[]> {
  const now = Date.now();
  if (liveAdsPromise && (now - liveAdsFetchedAt) < LIVE_ADS_TTL_MS) {
    return liveAdsPromise;
  }
  liveAdsFetchedAt = now;
  liveAdsPromise = getLiveAds();
  // If the fetch errors out, drop the cache so the next call retries.
  liveAdsPromise.catch(() => { liveAdsPromise = null; });
  return liveAdsPromise;
}

export function invalidateLiveAds(): void {
  liveAdsPromise = null;
  liveAdsFetchedAt = 0;
}

// ── Tier-1 catalog fast path ────────────────────────────────────────────
// Maps a user query (e.g. "shoes", "pants") to the canonical product.type
// values present in the DB. catalog_tags is too sparsely populated to be
// useful as the primary signal — `products.type` is the normalized column
// (Top, Pants, Sneakers, Boots, Dress, etc.) actually filled by the scraper.
//
// Keys are pre-normalized (lowercase, trimmed). Values match the casing of
// the `type` column exactly. Add new entries here as new catalog terms appear.
const CATALOG_TYPE_SYNONYMS: Record<string, string[]> = {
  // Footwear
  shoes:        ['Sneakers', 'Boots', 'Sandals', 'Heels', 'Loafers', 'Flats', 'Mules'],
  sneakers:     ['Sneakers'],
  boots:        ['Boots'],
  sandals:      ['Sandals'],
  heels:        ['Heels'],
  loafers:      ['Loafers'],
  flats:        ['Flats'],
  // Tops
  tops:         ['Top'],
  top:          ['Top'],
  shirts:       ['Top'],
  shirt:        ['Top'],
  tshirts:      ['Top'],
  't-shirts':   ['Top'],
  blouses:      ['Top'],
  sweaters:     ['Top'],
  hoodies:      ['Top'],
  // Bottoms
  pants:        ['Pants'],
  trousers:     ['Pants'],
  jeans:        ['Pants'],
  shorts:       ['Shorts'],
  skirts:       ['Skirt'],
  skirt:        ['Skirt'],
  // Dresses
  dresses:      ['Dress'],
  dress:        ['Dress'],
  // Outerwear
  jackets:      ['Jacket'],
  jacket:       ['Jacket'],
  coats:        ['Coat'],
  coat:         ['Coat'],
  // Accessories
  hats:         ['Hat'],
  hat:          ['Hat'],
  bags:         ['Bag'],
  bag:          ['Bag'],
  scarves:      ['Scarf'],
  scarf:        ['Scarf'],
  socks:        ['Socks'],
  // Activewear / others
  activewear:   ['Activewear'],
  underwear:    ['Underwear'],
  swimwear:     ['Swimwear'],
  loungewear:   ['Loungewear'],
};

export function resolveCatalogTypes(query: string): string[] | null {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  return CATALOG_TYPE_SYNONYMS[key] || null;
}

// Used by the in-memory tier-1 filter in ContinuousFeed.
export function creativeMatchesCatalogQuery(ad: ProductAd, query: string): boolean {
  const types = resolveCatalogTypes(query);
  if (!types) return false;
  const t = (ad.product as { type?: string | null } | null | undefined)?.type;
  if (!t) return false;
  return types.includes(t);
}

// Returns live creatives whose product.type matches the synonym set for the
// given query. Used by the consumer feed to render existing catalogs
// synchronously without waiting on the nl-search semantic pipeline.
//
// Mirrors getLiveAds() filters (status=live, video present, product is_active,
// gender filter) so results drop into the same grid render path. is_elite is
// NOT required here — when a user explicitly asks for "shoes" we want every
// available creative for that catalog, not just the curated default-grid set.
export async function getCreativesByCatalogTag(query: string): Promise<ProductAd[]> {
  if (!supabase) return [];
  const types = resolveCatalogTypes(query);
  if (!types || types.length === 0) return [];

  const { data, error } = await supabase
    .from('product_creative')
    .select(`
      *,
      product:products!inner(id, name, brand, price, image_url, images, url, type, catalog_tags, is_active, is_elite, gender)
    `)
    .eq('status', 'live')
    .not('video_url', 'is', null)
    .in('product.type', types)
    .order('boosted_until', { ascending: false, nullsFirst: false })
    .order('created_at',     { ascending: false })
    .limit(60);

  if (error) {
    console.warn('[getCreativesByCatalogTag] query error:', error.message);
    return [];
  }
  const rows = (data || []) as ProductAd[];
  return rows.filter(ad => {
    const active = (ad.product as { is_active?: boolean } | null | undefined)?.is_active;
    if (active === false) return false;
    return passesGenderFilter(ad.product as { gender?: string | null } | null);
  });
}

export async function boostAd(id: string, hours = 24): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('product_creative')
    .update({ boosted_until: until })
    .eq('id', id);
  return { error: error?.message || null };
}

export async function getModerationQueue(): Promise<ProductAd[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('product_creative')
    .select(AD_SELECT)
    .eq('status', 'done')
    .not('video_url', 'is', null)
    .order('created_at', { ascending: false });
  if (error) return [];
  return (data || []) as ProductAd[];
}

export async function rejectAd(id: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase
    .from('product_creative')
    .update({ status: 'paused', enabled: false })
    .eq('id', id);
  return { error: error?.message || null };
}

export async function createProductAd(req: CreateAdRequest): Promise<{ data: ProductAd | null; error: string | null }> {
  if (!supabase) return { data: null, error: 'Supabase not configured' };
  const { data, error } = await supabase
    .from('product_creative')
    .insert({
      product_id: req.product_id,
      style: req.style,
      affiliate_url: req.affiliate_url || null,
      status: 'pending',
    })
    .select(AD_SELECT)
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as ProductAd, error: null };
}

// Maximum concurrent generations the backend worker / Fal.ai account can run
// in parallel. Anything above this gets queued. Set to 2 to match Fal.ai's
// default starter concurrency (new accounts get 2 concurrent requests; scales
// up to 40 with credit purchases).
const CONCURRENCY_LIMIT = 2;

export interface GenerationOptions {
  durationSeconds?: number;
  withAudio?: boolean;
}

export async function createBatchAds(
  productIds: string[],
  style: string,
  count: number = 2,
  model?: string | string[],
  options: GenerationOptions = {},
): Promise<{ data: ProductAd[]; error: string | null }> {
  if (!supabase) return { data: [], error: 'Supabase not configured' };

  // Count currently in-flight jobs so we only start up to CONCURRENCY_LIMIT
  // and queue the rest. Backend worker promotes 'queued' → 'pending' as slots
  // free up (see promoteQueuedAds below — called from the client poll loop).
  const { count: activeCount } = await supabase
    .from('product_creative')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pending', 'generating']);

  const inFlight = activeCount || 0;
  const slotsAvailable = Math.max(0, CONCURRENCY_LIMIT - inFlight);

  // When `model` is an array, each entry maps 1:1 to a generated row so you
  // can, e.g., run one Veo + one Seedance for the same product in one batch.
  // When it's a single string (or undefined), all rows share that model.
  const pickModel = (i: number): string | undefined => {
    if (Array.isArray(model)) return model[i % model.length];
    return model;
  };

  const allRows = productIds.flatMap(product_id =>
    Array.from({ length: count }, (_, i) => {
      const m = pickModel(i);
      return {
        product_id,
        style,
        // Force portrait aspect so the generated video fills the vertical
        // feed cards end-to-end (no letterboxing).
        aspect_ratio: '9:16',
        ...(m ? { model: m } : {}),
        ...(options.durationSeconds != null ? { duration_seconds: options.durationSeconds } : {}),
        ...(options.withAudio != null ? { with_audio: options.withAudio } : {}),
      };
    })
  );

  const rows = allRows.map((row, i) => ({
    ...row,
    status: (i < slotsAvailable ? 'pending' : 'queued') as 'pending' | 'queued',
  }));

  const { data, error } = await supabase
    .from('product_creative')
    .insert(rows)
    .select(AD_SELECT);

  if (error) return { data: [], error: error.message };
  return { data: (data || []) as ProductAd[], error: null };
}

// Promote oldest queued rows to pending up to the concurrency limit.
// Called periodically from the client poll loop so queued ads drain as
// pending/generating ads complete.
export async function promoteQueuedAds(): Promise<{ promoted: number; error: string | null }> {
  if (!supabase) return { promoted: 0, error: 'Supabase not configured' };

  const { count: activeCount } = await supabase
    .from('product_creative')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pending', 'generating']);

  const inFlight = activeCount || 0;
  const slotsAvailable = Math.max(0, CONCURRENCY_LIMIT - inFlight);
  if (slotsAvailable === 0) return { promoted: 0, error: null };

  const { data: queuedRows, error: queryErr } = await supabase
    .from('product_creative')
    .select('id')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(slotsAvailable);

  if (queryErr) return { promoted: 0, error: queryErr.message };
  const ids = (queuedRows || []).map(r => r.id);
  if (ids.length === 0) return { promoted: 0, error: null };

  const { error } = await supabase
    .from('product_creative')
    .update({ status: 'pending' })
    .in('id', ids);

  if (error) return { promoted: 0, error: error.message };
  return { promoted: ids.length, error: null };
}

export async function regenerateAd(id: string, promptExtra?: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  // prompt_extra is appended by the video-generator worker onto the freshly
  // generated prompt at regeneration time. Empty string clears it.
  const patch: Record<string, unknown> = {
    status: 'pending',
    error: null,
    video_url: null,
    storage_path: null,
    prompt: null,
    completed_at: null,
  };
  if (promptExtra !== undefined) {
    patch.prompt_extra = promptExtra.trim() ? promptExtra.trim() : null;
  }
  const { error } = await supabase.from('product_creative').update(patch).eq('id', id);
  if (error) return { error: error.message };
  return { error: null };
}

export async function setAdLive(id: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase
    .from('product_creative')
    .update({ status: 'live', enabled: true })
    .eq('id', id);
  if (error) return { error: error.message };
  return { error: null };
}

export async function pauseAd(id: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase
    .from('product_creative')
    .update({ status: 'paused', enabled: false })
    .eq('id', id);
  if (error) return { error: error.message };
  return { error: null };
}

export async function deleteProductAd(id: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase
    .from('product_creative')
    .delete()
    .eq('id', id);
  if (error) return { error: error.message };
  return { error: null };
}

/** Delete an entire product from the catalog. Cascades through every
 *  creative that references it (the FK has ON DELETE CASCADE in the
 *  product_creative schema), so this is the heavy hammer the consumer
 *  feed's super-admin long-press uses to nuke a product end-to-end. */
export async function deleteProduct(id: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  // Defensive cleanup first — explicitly drop every creative referencing
  // this product so we never end up with orphan rows even if the FK
  // cascade isn't set up on a given env.
  await supabase.from('product_creative').delete().eq('product_id', id);
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id);
  if (error) return { error: error.message };
  return { error: null };
}

// Flip the elite flag on a creative AND its parent product together. Marking
// a product elite requires that at least one of its creatives is elite, so we
// keep the two in sync from this one entry point. Used by the admin Creative
// view and surfaces in investor deck v1.1's background feed.
export async function setAdElite(
  id: string,
  productId: string,
  isElite: boolean,
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error: adError } = await supabase
    .from('product_creative')
    .update({ is_elite: isElite })
    .eq('id', id);
  if (adError) return { error: adError.message };

  if (isElite) {
    const { error: productError } = await supabase
      .from('products')
      .update({ is_elite: true })
      .eq('id', productId);
    if (productError) return { error: productError.message };
  } else {
    // If no other elite creatives remain for this product, unmark it.
    const { data: remaining } = await supabase
      .from('product_creative')
      .select('id')
      .eq('product_id', productId)
      .eq('is_elite', true)
      .limit(1);
    if (!remaining || remaining.length === 0) {
      await supabase
        .from('products')
        .update({ is_elite: false })
        .eq('id', productId);
    }
  }
  return { error: null };
}

// Fetch every elite creative (product creatives + generated look videos) with
// a playable video_url. Used by the deck v1.1 background feed so the investor
// view only ever shows hand-picked work.
export interface EliteCreative {
  id: string;
  source: 'product' | 'look';
  video_url: string;
}

export async function getEliteCreatives(): Promise<EliteCreative[]> {
  if (!supabase) return [];
  const [adsRes, vidsRes] = await Promise.all([
    supabase
      .from('product_creative')
      .select('id, video_url')
      .eq('is_elite', true)
      .not('video_url', 'is', null),
    supabase
      .from('generated_videos')
      .select('id, video_url')
      .eq('is_elite', true)
      .not('video_url', 'is', null),
  ]);
  const ads = (adsRes.data || []).map(r => ({ id: r.id as string, source: 'product' as const, video_url: r.video_url as string }));
  const vids = (vidsRes.data || []).map(r => ({ id: r.id as string, source: 'look' as const, video_url: r.video_url as string }));
  return [...ads, ...vids];
}

export async function updateAdAffiliateUrl(id: string, url: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase
    .from('product_creative')
    .update({ affiliate_url: url })
    .eq('id', id);
  if (error) return { error: error.message };
  return { error: null };
}

// Other live creatives from the same brand. Used by ProductPage's
// "More from this brand" rail. Excludes the seed product so we don't echo
// the hero. Uses an inner-join filter on products.brand.
export async function getCreativesByBrand(
  brand: string,
  excludeProductId: string | null,
  limit = 12,
): Promise<ProductAd[]> {
  if (!supabase || !brand) return [];
  // Pull a margin over `limit` so the gender post-filter doesn't
  // leave the rail short. We still cap the returned slice to `limit`.
  const fetchLimit = shopperGender === 'unknown' ? limit : Math.min(limit * 2, 48);
  let query = supabase
    .from('product_creative')
    .select(`
      *,
      product:products!inner(id, name, brand, price, image_url, images, url, catalog_tags, gender)
    `)
    .eq('status', 'live')
    .eq('product.brand', brand)
    .not('video_url', 'is', null)
    .order('boosted_until', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(fetchLimit);
  if (excludeProductId) query = query.neq('product_id', excludeProductId);
  const { data, error } = await query;
  if (error) {
    console.warn('[getCreativesByBrand] query error:', error.message);
    return [];
  }
  const rows = (data || []) as ProductAd[];
  return rows.filter(r => passesGenderFilter(r.product as { gender?: string | null } | null)).slice(0, limit);
}

// Look up creatives (with playable video) for an arbitrary set of product
// UUIDs. Used by the consumer feed to surface video ads for products that
// nl-search returned but which aren't in the curated `is_elite` rotation.
// Falls back gracefully — products with no creative simply drop out.
//
// Results are returned in the same order as `productIds` (rank-preserving)
// so the caller can prepend them to the feed without re-sorting. When a
// product has multiple creatives, the most recently-completed one wins.
export async function getCreativesByProductIds(productIds: string[]): Promise<ProductAd[]> {
  if (!supabase || productIds.length === 0) return [];
  const { data, error } = await supabase
    .from('product_creative')
    .select(AD_SELECT)
    .in('product_id', productIds)
    .eq('status', 'live')
    .not('video_url', 'is', null)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[getCreativesByProductIds] query error:', error.message);
    return [];
  }
  // Pick the freshest creative per product, then sort by the order of
  // productIds so semantic rank is preserved.
  const byProduct = new Map<string, ProductAd>();
  for (const row of (data || []) as ProductAd[]) {
    if (!byProduct.has(row.product_id)) byProduct.set(row.product_id, row);
  }
  const ordered: ProductAd[] = [];
  for (const id of productIds) {
    const hit = byProduct.get(id);
    if (hit) ordered.push(hit);
  }
  return ordered;
}

// Resolve a ranked list of look UUIDs to live product creatives by walking
// look_products → products → product_creative. Used by the semantic search
// path: nl-search frequently returns looks (e.g. "summer", "red carpet"),
// but the feed surface is creative-only, so we hydrate each look into the
// creatives that back its products.
//
// Rank-preserving: results are emitted in look order, then by sort_order
// within each look. Deduped by product_id so a single product that appears
// in multiple semantic looks only surfaces once.
export async function getCreativesByLookIds(lookIds: string[]): Promise<ProductAd[]> {
  if (!supabase || lookIds.length === 0) return [];
  // 1) look_id → ordered product_ids
  const { data: lpRows, error: lpErr } = await supabase
    .from('look_products')
    .select('look_id, product_id, sort_order')
    .in('look_id', lookIds);
  if (lpErr) {
    console.warn('[getCreativesByLookIds] look_products error:', lpErr.message);
    return [];
  }
  if (!lpRows || lpRows.length === 0) return [];

  // Preserve look rank, then sort_order within each look. Dedupe product_ids
  // (a product shared across two semantic-hit looks should only appear once).
  const lookRank = new Map<string, number>();
  lookIds.forEach((id, idx) => lookRank.set(id, idx));
  const seenProductIds = new Set<string>();
  const orderedProductIds: string[] = [];
  const sorted = [...(lpRows as Array<{ look_id: string; product_id: string; sort_order: number | null }>)]
    .sort((a, b) => {
      const ra = lookRank.get(a.look_id) ?? Infinity;
      const rb = lookRank.get(b.look_id) ?? Infinity;
      if (ra !== rb) return ra - rb;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
  for (const row of sorted) {
    if (seenProductIds.has(row.product_id)) continue;
    seenProductIds.add(row.product_id);
    orderedProductIds.push(row.product_id);
  }
  if (orderedProductIds.length === 0) return [];

  // 2) Reuse the existing product → creative resolver (preserves order).
  return getCreativesByProductIds(orderedProductIds);
}

// Per-brand promise cache so hover and tap coalesce.
const brandCache = new Map<string, Promise<ProductAd[]>>();

export function prefetchCreativesByBrand(
  brand: string,
  excludeProductId: string | null,
  limit = 12,
): Promise<ProductAd[]> {
  const key = `${brand}|${excludeProductId ?? ''}|${limit}`;
  const cached = brandCache.get(key);
  if (cached) return cached;
  const p = getCreativesByBrand(brand, excludeProductId, limit);
  brandCache.set(key, p);
  p.catch(() => brandCache.delete(key));
  return p;
}

// Per-seed promise cache — coalesces hover + tap into one network round-trip.
// Keyed by `${seedId}|${k}` so different rail sizes don't collide.
const similarCache = new Map<string, Promise<ProductAd[]>>();

/** Idempotent prefetch — call from hover, tap, anywhere. Returns the same
 *  cached promise on subsequent calls so consumers can `await` and get an
 *  instant resolve once the first call has finished. */
export function prefetchSimilarCreatives(seedId: string, k = 12): Promise<ProductAd[]> {
  const key = `${seedId}|${k}`;
  const cached = similarCache.get(key);
  if (cached) return cached;
  const p = getSimilarCreatives(seedId, k);
  similarCache.set(key, p);
  // If it errors, drop the cache so the next call retries.
  p.catch(() => similarCache.delete(key));
  return p;
}

// Returns the K visually-nearest creatives to the seed, deduped by product.
// Backed by find_similar_creatives() — uses Marengo 3.0 cosine distance when
// the seed has an embedding, otherwise falls back to same-brand → newest.
export async function getSimilarCreatives(seedId: string, k = 12): Promise<ProductAd[]> {
  if (!supabase) return [];
  // Pull a margin so the gender post-filter doesn't leave the rail short.
  const fetchK = shopperGender === 'unknown' ? k : Math.min(k * 2, 48);
  const { data, error } = await supabase.rpc('find_similar_creatives', { seed_id: seedId, k: fetchK });
  if (error || !data) {
    if (error) console.warn('[getSimilarCreatives] rpc error:', error.message);
    return [];
  }
  // The RPC doesn't return product.gender, so when a gender scope is
  // active we hydrate the missing column with one batched lookup
  // before post-filtering. Untagged products stay visible.
  let genderById: Map<string, string | null> | null = null;
  if (shopperGender !== 'unknown') {
    const ids = Array.from(new Set((data as Array<{ product_id: string }>).map(r => r.product_id))).filter(Boolean);
    if (ids.length > 0) {
      const { data: prods } = await supabase
        .from('products')
        .select('id, gender')
        .in('id', ids);
      genderById = new Map((prods || []).map((p: { id: string; gender: string | null }) => [p.id, p.gender]));
    }
  }
  const mapped = (data as Array<{
    id: string;
    product_id: string;
    video_url: string | null;
    thumbnail_url: string | null;
    product_name: string | null;
    product_brand: string | null;
    distance: number;
  }>).map(row => ({
    id: row.id,
    product_id: row.product_id,
    look_id: null,
    title: null,
    description: null,
    video_url: row.video_url,
    storage_path: null,
    thumbnail_url: row.thumbnail_url,
    affiliate_url: null,
    prompt: null,
    prompt_extra: null,
    style: '',
    model: null,
    status: 'live',
    duration_seconds: null,
    aspect_ratio: null,
    resolution: null,
    cost_usd: null,
    impressions: 0,
    clicks: 0,
    error: null,
    enabled: true,
    created_at: '',
    completed_at: null,
    updated_at: null,
    product: {
      id: row.product_id,
      name: row.product_name,
      brand: row.product_brand,
      price: null,
      image_url: null,
      url: null,
    },
  } as ProductAd));
  if (!genderById) return mapped.slice(0, k);
  return mapped
    .filter(ad => passesGenderFilter({ gender: genderById!.get(ad.product_id) ?? null }))
    .slice(0, k);
}

// Impression batching. The consumer feed mounts ~50 CreativeCards at once
// and each fires its own impression RPC the moment the card enters the
// pre-viewport band — that's 50 individual Supabase requests inside the
// first 1–2 s of page load, fighting for the same connection pool as the
// looks fetch and the videos. Coalescing into one flush per ~1 s window
// dedupes scroll-spam (a card flickering across the IO threshold during
// fast scroll) and gives the browser breathing room.
//
// We still fire N RPCs per flush — Supabase doesn't currently expose a
// bulk-increment endpoint — but they're issued in parallel from a single
// idle tick instead of staggered across the first second of the session.

const impressionQueue = new Map<string, number>();
let flushTimer: number | null = null;

function flushImpressions() {
  flushTimer = null;
  if (!supabase || impressionQueue.size === 0) return;
  const ids = [...impressionQueue.keys()];
  impressionQueue.clear();
  // Parallel issue. .catch swallows so a single network failure doesn't
  // kill the rest of the flush.
  for (const id of ids) {
    supabase.rpc('increment_product_creative_impressions', { creative_id: id })
      .then(() => undefined, () => undefined);
  }
}

export function trackAdImpression(id: string): void {
  if (!supabase) return;
  // First time we see this id in the current window — queue it. Repeat
  // sightings within the same window are no-ops.
  if (impressionQueue.has(id)) return;
  impressionQueue.set(id, Date.now());
  if (flushTimer == null && typeof window !== 'undefined') {
    flushTimer = window.setTimeout(flushImpressions, 1000);
  }
}

// Best-effort flush on tab close so impressions queued in the last <1 s
// don't get lost. sendBeacon is the only API that survives unload, but
// it requires a fixed URL — fall back to a synchronous fetch if not
// available. We just trigger the same flush; the rpc calls fire-and-
// forget anyway.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (impressionQueue.size > 0) flushImpressions();
  });
}

export async function trackAdClick(id: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc('increment_product_creative_clicks', { creative_id: id });
  } catch { /* fire-and-forget */ }
}
