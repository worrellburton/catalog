import { supabase } from '~/utils/supabase';
import { posterRendition } from '~/utils/poster-prefetch';
import {
  getProductSimilarityThreshold,
  subscribeProductSimilarityThreshold,
  DEFAULT_PRODUCT_SIMILARITY,
} from '~/services/dials';

// Module-level shopper gender. Consumer routes call setShopperGender
// once after auth resolves so every product-creative query (brand
// strip, similar rail, live ads) can scope to male+unisex / female+
// unisex without each caller threading the gender prop through.
// 'unknown' (the default) disables filtering - we never hide the
// catalog from someone we can't tag.
type ShopperGender = 'male' | 'female' | 'unknown';
const GENDER_LS_KEY = 'catalog:shopper-gender';

function readGenderFromStorage(): ShopperGender {
  if (typeof window === 'undefined') return 'unknown';
  try {
    const v = window.localStorage.getItem(GENDER_LS_KEY);
    if (v === 'male' || v === 'female') return v;
  } catch { /* ignore */ }
  return 'unknown';
}

let shopperGender: ShopperGender = readGenderFromStorage();

// Pub/sub for gender changes. Consumers (ContinuousFeed, etc.) need to
// re-fetch when the gender resolves AFTER they've already pulled a
// cached unfiltered feed. Without this, a male user sees a mixed feed
// because module-load prefetchHomeFeed() fired before auth resolved.
type GenderChangeListener = (g: ShopperGender) => void;
const genderListeners = new Set<GenderChangeListener>();

export function subscribeToShopperGender(cb: GenderChangeListener): () => void {
  genderListeners.add(cb);
  return () => { genderListeners.delete(cb); };
}

export function getShopperGender(): ShopperGender {
  return shopperGender;
}

// Per-key cache for the description-embedding "Similar" rail (keyed by product
// id). Declared up here — before setShopperGender clears it — so it's never a
// forward-ref (TDZ chunk-order safety; see scripts/check-tdz-forward-refs).
const similarProductCache = new Map<string, Promise<ProductAd[]>>();

export function setShopperGender(g: ShopperGender) {
  if (g === shopperGender) return;
  shopperGender = g;
  try { window.localStorage.setItem(GENDER_LS_KEY, g); } catch { /* ignore */ }
  // Drop caches so the next callers re-fetch with the new scope.
  homeFeedPromise = null;
  brandCache.clear();
  similarProductCache.clear();
  // Notify subscribers so they can re-pull. Wrap each call in try/catch
  // so a single bad listener doesn't break the rest.
  for (const cb of genderListeners) {
    try { cb(g); } catch { /* ignore */ }
  }
}

// Product similarity threshold — loaded once on first call, subscribed
// for live admin updates. 0 = no filter (all K neighbours shown).
// >0 = only items where (1 − cosine_distance) ≥ threshold/100 pass.
let _productSimilarityThreshold = DEFAULT_PRODUCT_SIMILARITY;
let _productSimilarityThresholdReady = false;

async function ensureProductSimilarityThreshold(): Promise<number> {
  if (_productSimilarityThresholdReady) return _productSimilarityThreshold;
  _productSimilarityThreshold = await getProductSimilarityThreshold();
  _productSimilarityThresholdReady = true;
  subscribeProductSimilarityThreshold(v => { _productSimilarityThreshold = v; });
  return _productSimilarityThreshold;
}

// Gender-scoped suffix for the localStorage live-ads cache key. Without
// this, a male user's cached feed would surface for a female user on
// next visit (and vice versa). Unknown stays on the bare key so logged-
// out users still benefit from a recent shared cache.
function genderCacheSuffix(): string {
  return shopperGender === 'unknown' ? '' : `:${shopperGender}`;
}

/** Returns the genders we should accept for the current shopper. */
function visibleGenders(): Array<'male' | 'female' | 'unisex'> | null {
  if (shopperGender === 'male') return ['male', 'unisex'];
  if (shopperGender === 'female') return ['female', 'unisex'];
  return null; // 'unknown' → no filter
}

/** Post-filter products by the shopper's gender. Untagged products
 *  (gender is null) only pass when the shopper themselves has no
 *  gender set - once we know the shopper is male/female we hide
 *  unscoped rows so the feed doesn't surface random off-domain
 *  inventory ("Dune", houseplants, pet beds, etc.) that nobody
 *  bothered to tag. The Gender Audit on /admin/content fills the
 *  column for everything that should be visible. */
function passesGenderFilter(p: { gender?: string | null } | null | undefined): boolean {
  if (!p) return false;
  if (shopperGender === 'unknown') return true;
  const g = p.gender;
  if (!g) return false; // untagged → hidden from gendered shoppers
  if (g === 'unisex') return true;
  if (shopperGender === 'male') return g === 'male';
  if (shopperGender === 'female') return g === 'female';
  return true;
}

export interface ProductAd {
  id: string;
  product_id: string;
  look_id: string | null;
  /** Admin-assigned unified feed position (looks + products share one rank
   *  space via apply_feed_order). Lower = earlier. null/undefined = unranked
   *  (falls to the end). Drives the consumer feed order so it matches the
   *  /admin/catalogs FEED editor exactly. */
  feed_rank?: number | null;
  title: string | null;
  description: string | null;
  video_url: string | null;
  /** Mobile-optimized variant of video_url: 480p H.264 ~600kbps, much
   *  smaller bitrate so cellular users get a playable first frame in a
   *  fraction of the time. The renderer picks this on narrow viewports
   *  + slow connections; full-res streams in the background while the
   *  user browses (see prefetchHighResForFeed) so tapping into a
   *  detail view is a cache hit. */
  mobile_video_url: string | null;
  /** HLS master playlist (adaptive 480/720/1080 ladder). When present the
   *  renderer plays THIS one source on every surface — the player ramps to a
   *  high rung at full-screen size with no src swap. Falls back to
   *  video_url / mobile_video_url when null. */
  hls_url: string | null;
  /** HEVC fMP4 HLS master — preferred on native-HLS devices that decode HEVC
   *  (iOS/Safari) for ~15-25% fewer bytes. Falls back to hls_url when null. */
  hls_hevc_url?: string | null;
  /** AV1 progressive MP4 — preferred on the desktop path where the device has a
   *  confirmed-smooth AV1 decoder. Falls back to video_url when null. */
  video_av1_url?: string | null;
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
  product?: { id: string; name: string | null; brand: string | null; price: string | null; image_url: string | null; primary_image_url?: string | null; primary_video_url?: string | null; primary_hls_url?: string | null; primary_hls_hevc_url?: string | null; primary_video_av1_url?: string | null; primary_video_poster_url?: string | null; images?: string[] | null; url: string | null; type?: string | null; catalog_tags?: string[] | null; gender?: string | null; is_elite?: boolean };
}

export interface CreateAdRequest {
  product_id: string;
  style: string;
  affiliate_url?: string;
}

const AD_SELECT = `
  *,
  product:products(id, name, brand, price, image_url, primary_image_url, primary_video_url, primary_hls_url, primary_hls_hevc_url, primary_video_av1_url, primary_video_poster_url, images, url, type, catalog_tags, is_active, is_elite, gender)
`;

// Columns for a product-direct tile fetch. Mirrors the getHomeFeed select so
// catalog / brand / similar surfaces all render from the SAME visibility
// contract: one product = one tile, sourced from products.primary_video_url.
const PRODUCT_TILE_SELECT =
  'id, name, brand, price, image_url, primary_image_url, primary_video_url, primary_hls_url, primary_hls_hevc_url, primary_video_av1_url, primary_video_poster_url, primary_video_generated_at, images, url, type, gender, is_elite, created_at';

interface ProductTileRow {
  id: string;
  name: string | null;
  brand: string | null;
  price: string | null;
  image_url: string | null;
  primary_image_url: string | null;
  primary_video_url: string | null;
  primary_hls_url?: string | null;
  primary_hls_hevc_url?: string | null;
  primary_video_av1_url?: string | null;
  primary_video_poster_url: string | null;
  images: string[] | null;
  url: string | null;
  type: string | null;
  gender: string | null;
  is_elite: boolean | null;
  primary_video_generated_at?: string | null;
  created_at?: string | null;
}

// Map a product row → a one-tile ProductAd. The renderer (CreativeCardV2 /
// pickVideoUrl) always prefers product.primary_video_url for playback, so a
// product with no primary video is simply never fetched into a tile — the
// hard "no primary video → not on any feed" rule lives at the query layer.
function productTileToAd(p: ProductTileRow, style: string): ProductAd {
  return {
    id:               p.id,
    product_id:       p.id,
    look_id:          null,
    title:            p.name,
    description:      null,
    video_url:        p.primary_video_url,
    mobile_video_url: null,
    hls_url:          p.primary_hls_url ?? null,
    hls_hevc_url:     p.primary_hls_hevc_url ?? null,
    video_av1_url:    p.primary_video_av1_url ?? null,
    storage_path:     null,
    thumbnail_url:    p.primary_video_poster_url ?? p.primary_image_url,
    affiliate_url:    null,
    prompt:           null,
    prompt_extra:     null,
    style,
    model:            null,
    status:           'live',
    duration_seconds: null,
    aspect_ratio:     '3:4',
    resolution:       null,
    cost_usd:         null,
    impressions:      0,
    clicks:           0,
    error:            null,
    enabled:          true,
    is_elite:         p.is_elite ?? undefined,
    created_at:       p.primary_video_generated_at ?? p.created_at ?? '',
    completed_at:     p.primary_video_generated_at ?? null,
    updated_at:       null,
    product: {
      id:                       p.id,
      name:                     p.name,
      brand:                    p.brand,
      price:                    p.price,
      image_url:                p.image_url,
      primary_image_url:        p.primary_image_url,
      primary_video_url:        p.primary_video_url,
      primary_hls_url:          p.primary_hls_url,
      primary_hls_hevc_url:     p.primary_hls_hevc_url,
      primary_video_av1_url:    p.primary_video_av1_url,
      primary_video_poster_url: p.primary_video_poster_url,
      images:                   p.images,
      url:                      p.url,
      type:                     p.type,
      gender:                   p.gender,
      is_elite:                 p.is_elite ?? undefined,
    },
  };
}

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

/**
 * Fast, fuzzy product-image lookup for the search ceremony's "products
 * forming" preview. NOT the real search — just a cheap one-shot match so
 * related products float in immediately as a precursor while the real
 * semantic search resolves. Two lanes, merged name-matches first:
 *   1. name / type / brand ILIKE (object queries — "shoes" floats shoes)
 *   2. catalog-tag containment via the catalogs registry (vibe queries —
 *      "clean girl aesthetic" floats products tagged with that catalog,
 *      where no product NAME would ever match the phrase)
 * Returns de-duped image URLs. Never throws.
 */
export async function getProductImagesForQuery(query: string, limit = 16): Promise<string[]> {
  if (!supabase) return [];
  const sb = supabase;
  // Sanitize to alphanumerics + spaces so the value is safe to drop into a
  // PostgREST or() filter (which has its own delimiter grammar).
  const safe = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!safe) return [];
  // Match the whole phrase plus each token and a de-pluralized variant
  // (so "shoes" also hits "shoe", "jeans" → "jean") across name + type.
  const variants = new Set<string>([safe]);
  for (const t of safe.split(' ')) {
    if (t.length < 2) continue;
    variants.add(t);
    if (t.endsWith('s') && t.length > 3) variants.add(t.slice(0, -1));
  }
  const orParts: string[] = [];
  for (const v of variants) orParts.push(`name.ilike.*${v}*`, `type.ilike.*${v}*`);
  orParts.push(`brand.ilike.*${safe}*`);

  type ImgRow = { primary_image_url: string | null; image_url: string | null };
  const IMG_COLS = 'primary_image_url, image_url';

  const nameLane = sb
    .from('products')
    .select(IMG_COLS)
    .eq('is_active', true)
    .or(orParts.join(','))
    .limit(limit)
    .then(({ data }) => (data ?? []) as ImgRow[], () => [] as ImgRow[]);

  // Vibe lane: find the closest catalog rows by token, then products tagged
  // with them. Tags are written as the catalog NAME by admin tooling and as
  // the slug by some older paths, so containment checks both. Best catalog =
  // most query tokens present in its name (client-side score; the or() match
  // can't rank).
  const tagLane = (async (): Promise<ImgRow[]> => {
    const tokenOr = [...variants].map(v => `name.ilike.*${v}*`).join(',');
    const { data: cats } = await sb
      .from('catalogs')
      .select('slug, name')
      .or(tokenOr)
      .limit(6);
    if (!cats?.length) return [];
    const tokens = safe.split(' ');
    const best = [...(cats as { slug: string; name: string }[])]
      .sort((a, b) =>
        tokens.filter(t => b.name.includes(t)).length
        - tokens.filter(t => a.name.includes(t)).length,
      )[0];
    const byTag = (tag: string) => sb
      .from('products')
      .select(IMG_COLS)
      .eq('is_active', true)
      .contains('catalog_tags', [tag])
      .limit(limit)
      .then(({ data }) => (data ?? []) as ImgRow[], () => [] as ImgRow[]);
    const [byName, bySlug] = await Promise.all([byTag(best.name), byTag(best.slug)]);
    return [...byName, ...bySlug];
  })().catch(() => [] as ImgRow[]);

  const [named, tagged] = await Promise.all([nameLane, tagLane]);
  const imgs = [...named, ...tagged]
    .map(r => r.primary_image_url || r.image_url || '')
    .filter(Boolean);
  return [...new Set(imgs)].slice(0, limit);
}

export async function getHomeFeed(opts: { ignoreGender?: boolean } = {}): Promise<ProductAd[]> {
  if (!supabase) return [];
  // Visibility contract (product tiles):
  //   1. products.is_active = true   (the admin's "Home" toggle)
  //   2. products.primary_video_url IS NOT NULL  (the polished i2v clip
  //      we generate per-SKU — the consumer feed renders products as
  //      that video; no primary video → no tile, no fallback)
  //   3. shopper-gender filter (post-fetch)
  //
  // Note: the legacy product_creative table is no longer consulted on
  // the consumer path. It still exists for the admin /admin/data
  // Creatives column, but ads in there are no longer rendered to
  // shoppers. One product = one tile.
  //
  // is_elite leads so admin-flagged "really nice" SKUs surface first;
  // within each tier, newest primary_video first so the freshest
  // content lands on top of the grid.
  const { data, error } = await supabase
    .from('products')
    .select('id, name, brand, price, image_url, primary_image_url, primary_video_url, primary_hls_url, primary_hls_hevc_url, primary_video_av1_url, primary_video_poster_url, primary_video_generated_at, url, type, catalog_tags, is_active, is_elite, gender, created_at, feed_rank')
    .eq('is_active', true)
    .not('primary_video_url', 'is', null)
    // Admin-chosen catalog order (Recommend Order / saved order) leads;
    // unranked items fall back to the elite → freshest tiebreakers.
    .order('feed_rank',                 { ascending: true,  nullsFirst: false })
    .order('is_elite',                  { ascending: false, nullsFirst: false })
    .order('primary_video_generated_at',{ ascending: false, nullsFirst: false })
    .order('created_at',                { ascending: false })
    // Feed cycles + paginates client-side (FeedSection) and only ~60 rows are
    // cached, so this cap is invisible to the user but bounds the wire payload,
    // JSON parse, and in-memory ProductAd[] as the catalog grows.
    .limit(300);
  if (error) {
    console.error('[getHomeFeed] query error:', error.message);
    return [];
  }
  type ProductRow = {
    id: string;
    name: string | null; brand: string | null; price: string | null;
    image_url: string | null; primary_image_url: string | null;
    primary_video_url: string | null;
    primary_hls_url: string | null;
    primary_hls_hevc_url: string | null;
    primary_video_av1_url: string | null;
    primary_video_poster_url: string | null;
    primary_video_generated_at: string | null;
    url: string | null;
    type: string | null; catalog_tags: string[] | null;
    is_active: boolean; is_elite: boolean | null;
    gender: string | null; created_at: string;
    feed_rank: number | null;
  };
  const products = (data || []) as ProductRow[];
  // Synthesize ProductAd rows so the renderer doesn't need to know we
  // changed source tables. Each product becomes one tile: id = product
  // id (so dedup-by-id continues to work), video_url + thumbnail_url
  // point at the primary video + image, the joined product object
  // carries the same field set the renderer already reads.
  const deduped: ProductAd[] = products.map((p): ProductAd => ({
    id:                p.id,
    product_id:        p.id,
    look_id:           null,
    title:             p.name,
    description:       null,
    video_url:         p.primary_video_url,
    mobile_video_url:  null,
    hls_url:           p.primary_hls_url ?? null,
    hls_hevc_url:      p.primary_hls_hevc_url ?? null,
    video_av1_url:     p.primary_video_av1_url ?? null,
    storage_path:      null,
    thumbnail_url:     p.primary_video_poster_url ?? p.primary_image_url,
    affiliate_url:     null,
    prompt:            null,
    prompt_extra:      null,
    style:             '',
    model:             null,
    status:            'live',
    duration_seconds:  null,
    aspect_ratio:      '3:4',
    resolution:        null,
    cost_usd:          null,
    impressions:       0,
    clicks:            0,
    error:             null,
    enabled:           true,
    is_elite:          p.is_elite ?? undefined,
    feed_rank:         p.feed_rank,
    created_at:        p.primary_video_generated_at ?? p.created_at,
    completed_at:      p.primary_video_generated_at,
    updated_at:        null,
    product: {
      id:                p.id,
      name:              p.name,
      brand:             p.brand,
      price:             p.price,
      image_url:         p.image_url,
      primary_image_url: p.primary_image_url,
      primary_video_url: p.primary_video_url,
      primary_hls_url:   p.primary_hls_url,
      primary_hls_hevc_url: p.primary_hls_hevc_url,
      primary_video_av1_url: p.primary_video_av1_url,
      primary_video_poster_url: p.primary_video_poster_url,
      // Derived from the primary image instead of selecting the full images[]
      // array — the only consumer is images[0] as a poster fallback
      // (video-loading.ts, ProductPage), so a 1-element array preserves that
      // while dropping a JSON blob the feed never otherwise reads.
      images:            p.primary_image_url ? [p.primary_image_url] : (p.image_url ? [p.image_url] : null),
      url:               p.url,
      type:              p.type,
      catalog_tags:      p.catalog_tags,
      gender:            p.gender,
      is_elite:          p.is_elite ?? undefined,
    },
  }));
  // Products only. Looks are fetched separately (getLooks) and combined with
  // products by the SHARED feed_rank in FeedSection — that is the single place
  // the two content types are interleaved. Merging look-tiles in here too
  // double-rendered every look (once as a real look card from the looks lane,
  // once as a synthesized product tile) and, because looks and products each
  // carried their own 1..N feed_rank, scrambled the order. getHomeFeed is
  // strictly the PRODUCT lane now; the consumer order is reproduced by
  // FeedSection sorting looks+products on one unified feed_rank.
  //
  // Dedup defensively by product_id (the query can't emit a product twice
  // today, but a future join could) while preserving the feed_rank order the
  // query already applied.
  const seenProd = new Set<string>();
  const uniqMerged: ProductAd[] = [];
  for (const ad of deduped) {
    if (ad.product_id) {
      if (seenProd.has(ad.product_id)) continue;
      seenProd.add(ad.product_id);
    }
    uniqMerged.push(ad);
  }

  if (opts.ignoreGender) return uniqMerged;
  return uniqMerged.filter(ad =>
    passesGenderFilter(ad.product as { gender?: string | null } | null),
  );
}

// ── Home-feed prefetch ──────────────────────────────────────────────────
// The landing screen primes this so the consumer feed is already in memory
// (and its assets are warming) by the time the user signs in.
//
// We cache the in-flight Promise itself, not the resolved value, so multiple
// concurrent callers (LandingPage + ContinuousFeed mount races) coalesce onto
// a single network request. After it resolves, every caller awaits the same
// already-resolved Promise - effectively instant.
//
// Stale-while-revalidate: invalidate() clears the cache so the next caller
// kicks off a fresh fetch (used after admin actions). Also seeded from
// localStorage on module init so a returning visitor sees their last feed
// instantly, then we revalidate in the background.
let homeFeedPromise: Promise<ProductAd[]> | null = null;
let homeFeedFetchedAt = 0;
const HOME_FEED_TTL_MS = 60_000;
// Versioned key - bumping this number invalidates every existing
// localStorage cache the next time a consumer hits the page. Bump it
// whenever the feed-shape contract changes or whenever stale caches
// start surfacing content that should have been pulled (e.g. after a
// mass admin Home-toggle flip).
// v8: feed now sourced from products table directly (one product = one
// tile via primary_video_url), not product_creative. Old v7 cache rows
// keyed on creative ids, so bump the version to evict them cleanly.
// v9: rows now carry product.primary_video_poster_url (the 3:4 still
// extracted from the primary video). Stale v8 rows lack it and would
// fall back to the square primary_image_url (the zoomed-in poster), so
// evict them.
// v10: primary-video posters were re-extracted at frame 0 from each
// product's CURRENT video and re-keyed to .poster-v4.jpg (the old -v3
// posters were stale — taken from an older, more-zoomed clip). Cached v9
// rows still hold the stale -v3 thumbnail_url and keep rendering the
// zoomed poster, so evict them.
const HOME_FEED_LS_KEY = 'catalog:home-feed-cache:v13'; // v13: hls-v5 ladders (no B-frames, iOS-safe edit list, ~5Mbps top rung)
const HOME_FEED_LS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Seed the in-memory promise from localStorage on import so the feed
// hydrates instantly on return visits. Skipped on SSR / initial pageload
// without window. The background fetch in prefetchHomeFeed() always runs
// to keep data fresh.
function readHomeFeedFromStorage(): ProductAd[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(HOME_FEED_LS_KEY + genderCacheSuffix());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt: number; rows: ProductAd[] };
    if (!parsed || typeof parsed.savedAt !== 'number' || !Array.isArray(parsed.rows)) return null;
    if (Date.now() - parsed.savedAt > HOME_FEED_LS_MAX_AGE_MS) return null;
    return parsed.rows;
  } catch {
    return null;
  }
}

function writeHomeFeedToStorage(rows: ProductAd[]): void {
  if (typeof window === 'undefined') return;
  try {
    // Cap the persisted list to keep localStorage under quota - the cache
    // is purely a perceived-perf affordance; the network fetch always
    // returns the full set within a beat.
    const capped = rows.slice(0, 60);
    window.localStorage.setItem(
      HOME_FEED_LS_KEY + genderCacheSuffix(),
      JSON.stringify({ savedAt: Date.now(), rows: capped }),
    );
  } catch {
    /* quota exceeded - feed still works, just no fast-path next time */
  }
}

// Synchronous fast-path for first paint. Returns the last successful
// feed from localStorage (capped at 60 rows, 7-day TTL) so consumers
// can render an instant feed before the network fetch resolves. Pair
// with prefetchHomeFeed() for the revalidate side of SWR.
export function getCachedHomeFeed(): ProductAd[] | null {
  return readHomeFeedFromStorage();
}

export function prefetchHomeFeed(): Promise<ProductAd[]> {
  const now = Date.now();
  if (homeFeedPromise && (now - homeFeedFetchedAt) < HOME_FEED_TTL_MS) {
    return homeFeedPromise;
  }
  homeFeedFetchedAt = now;
  homeFeedPromise = getHomeFeed().then(rows => {
    // Always overwrite the cache, even when the fresh fetch is empty.
    // Otherwise an admin who turns every Home toggle off ends up with
    // a stale cache that keeps hydrating the consumer feed forever  -
    // the empty fetch was treated as "skip the write" and the old
    // rows stuck around on every reload.
    writeHomeFeedToStorage(rows);
    // Phase 7: while the user is still looking at the splash screen,
    // warm the browser's HTTP cache with the first few above-the-fold
    // creatives. Posters first (small, fast, immediate visual win) and
    // then the actual mobile video bytes. By the time the gate drops,
    // the feed grid renders against an already-populated cache.
    void warmAboveTheFoldAssets(rows);
    return rows;
  });
  // If the fetch errors out, drop the cache so the next call retries.
  homeFeedPromise.catch(() => { homeFeedPromise = null; });
  return homeFeedPromise;
}

// Warm the HTTP cache for the first ~6 above-the-fold creatives. We
// deliberately keep the fan-out small - mobile bandwidth is precious
// and the 6 tiles at the top of the grid are what the user sees during
// the first paint after the splash drops.
function warmAboveTheFoldAssets(rows: ProductAd[]): void {
  if (typeof window === 'undefined') return;
  const head = rows.slice(0, 6);
  for (const ad of head) {
    // Image cache hit for the poster - the <img loading=eager> on the
    // card immediately reuses this without a fresh round-trip.
    const posterRaw = ad.thumbnail_url || ad.product?.primary_image_url || ad.product?.image_url;
    // Warm the SAME rendition the card actually paints — posterRendition() is
    // the single canonical transform (CARD_POSTER_WIDTH / q82 / webp), NOT the
    // raw full-res original. Warming the raw URL fetched a 1–3 MB original the
    // card never displays AND still cache-missed the variant it does, so the top
    // tiles paid a double download.
    const poster = posterRendition(posterRaw) || posterRaw;
    if (poster) {
      try {
        const img = new Image();
        img.decoding = 'async';
        img.src = poster;
      } catch { /* ignore */ }
    }
    // Video cache hit for the mobile variant when present, fallback to
    // full-res. Lower priority so we don't compete with the splash
    // animation's own asset traffic.
    const url = ad.mobile_video_url || ad.video_url;
    if (url) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fetch(url, { headers: { Range: 'bytes=0-262143' }, priority: 'low' as any })
          .then(r => r.arrayBuffer())
          .catch(() => { /* ignore */ });
      } catch { /* ignore */ }
    }
  }
}

export function invalidateHomeFeed(): void {
  homeFeedPromise = null;
  homeFeedFetchedAt = 0;
  if (typeof window !== 'undefined') {
    // Drop every gender-scoped variant for both the current and any
    // historical key versions, so an admin invalidation clears every
    // cached view regardless of which build wrote it.
    try {
      const legacyBases = [
        'catalog:live-ads-cache',         // pre-rename
        'catalog:home-feed-cache',        // v1
        'catalog:home-feed-cache:v2',     // v2 (creative-only contract)
        'catalog:home-feed-cache:v3',     // v3 (briefly included product-only rows)
        'catalog:home-feed-cache:v4',     // v4 (type-required gate)
        'catalog:home-feed-cache:v5',     // v5 (no per-product dedup)
        'catalog:home-feed-cache:v6',     // v6 (pre-look-injection)
        'catalog:home-feed-cache:v10',    // v10 (pre-1s-HLS repoint)
        HOME_FEED_LS_KEY,                 // current
      ];
      for (const base of legacyBases) {
        for (const suffix of ['', ':male', ':female']) {
          window.localStorage.removeItem(base + suffix);
        }
      }
    } catch { /* ignore */ }
  }
}

// Fire the feed fetch the moment this module parses - runs in parallel
// with the React tree mounting, so by the time _index.tsx's splash
// timer is ticking the network round-trip is already on the wire. Same
// pattern services/looks.ts uses. Browser-only; no-op on SSR.
if (typeof window !== 'undefined') {
  void prefetchHomeFeed().catch(() => { /* surfaced on real caller */ });
  // Warm the brand index on idle so the sync resolver in ContinuousFeed
  // can short-circuit search the moment the user types a brand name.
  // Failures are silent - the async path still hydrates on first query.
  const warm = () => { void ensureBrandIndex().catch(() => undefined); };
  if (typeof (window as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback === 'function') {
    (window as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(warm);
  } else {
    setTimeout(warm, 250);
  }
  // Pre-warm poster images for the first batch of cached creatives so
  // they're in browser cache by the time React mounts. Decoupled from
  // the network promise above - this hits localStorage synchronously,
  // no extra round-trip.
  const cached = readHomeFeedFromStorage();
  if (cached) {
    for (const ad of cached.slice(0, 6)) {
      const url = ad.thumbnail_url
        || ad.product?.primary_image_url
        || ad.product?.image_url
        || (ad.product?.images && ad.product.images[0])
        || '';
      if (!url) continue;
      // new Image() forces the browser to start the fetch immediately;
      // when the real <img> mounts later it resolves from cache.
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
    }
  }
}

// ── Tier-1 catalog fast path ────────────────────────────────────────────
// Maps a user query (e.g. "shoes", "pants") to the canonical product.type
// values present in the DB. catalog_tags is too sparsely populated to be
// useful as the primary signal - `products.type` is the normalized column
// (Top, Pants, Sneakers, Boots, Dress, etc.) actually filled by the scraper.
//
// Keys are pre-normalized (lowercase, trimmed). Values match the casing of
// the `type` column exactly. Add new entries here as new catalog terms appear.
const CATALOG_TYPE_SYNONYMS: Record<string, string[]> = {
  // Footwear
  shoes:        ['Sneakers', 'Boots', 'Sandals', 'Heels', 'Loafers', 'Flats', 'Mules', 'Shoes'],
  shoe:         ['Sneakers', 'Boots', 'Sandals', 'Heels', 'Loafers', 'Flats', 'Mules', 'Shoes'],
  footwear:     ['Sneakers', 'Boots', 'Sandals', 'Heels', 'Loafers', 'Flats', 'Mules', 'Shoes'],
  sneakers:     ['Sneakers'],
  sneaker:      ['Sneakers'],
  trainers:     ['Sneakers'],
  runners:      ['Sneakers'],
  boots:        ['Boots'],
  boot:         ['Boots'],
  sandals:      ['Sandals'],
  sandal:       ['Sandals'],
  heels:        ['Heels'],
  heel:         ['Heels'],
  loafers:      ['Loafers'],
  loafer:       ['Loafers'],
  flats:        ['Flats'],
  mules:        ['Mules'],
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
  // Bottoms - "pants" is a generic term in shopper speech: yoga pants and
  // leggings get tagged Activewear, athletic shorts get tagged Shorts. Map
  // the generic term to the full bottom-wear set so users see the breadth
  // they expect. Specific terms (jeans, trousers) stay narrow.
  pants:        ['Pants', 'Shorts', 'Activewear'],
  pant:         ['Pants', 'Shorts', 'Activewear'],
  bottoms:      ['Pants', 'Shorts', 'Skirt', 'Activewear'],
  trousers:     ['Pants'],
  trouser:      ['Pants'],
  jeans:        ['Pants'],
  jean:         ['Pants'],
  denim:        ['Pants', 'Jacket', 'Shorts'],
  leggings:     ['Activewear', 'Pants'],
  legging:      ['Activewear', 'Pants'],
  joggers:      ['Pants', 'Activewear'],
  jogger:       ['Pants', 'Activewear'],
  sweatpants:   ['Pants', 'Activewear'],
  shorts:       ['Shorts'],
  short:        ['Shorts'],
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

// For material-based queries (e.g. "denim", "leather") the type-only filter
// is too broad - it returns all pants and all jackets regardless of material.
// This map narrows the DB results to products whose name contains the keyword.
// Keys must match the normalised (lowercase, trimmed) query keys in
// CATALOG_TYPE_SYNONYMS above.
const CATALOG_KEYWORD_FILTER: Record<string, string[]> = {
  denim:    ['denim', 'jean', 'jeans'],
  leather:  ['leather'],
  wool:     ['wool', 'cashmere', 'merino'],
  silk:     ['silk', 'satin'],
  cotton:   ['cotton'],
  linen:    ['linen'],
  velvet:   ['velvet'],
  knit:     ['knit', 'knitwear'],
};

export function resolveCatalogTypes(query: string): string[] | null {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  return CATALOG_TYPE_SYNONYMS[key] || null;
}

// Returns the material keywords (lowercased) that a product name MUST contain
// for the given query to keep it. Returns null when the query is not a
// material query - caller should not apply any name filter in that case.
export function resolveMaterialKeywords(query: string): string[] | null {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  return CATALOG_KEYWORD_FILTER[key] || null;
}

// Used by the in-memory tier-1 filter in ContinuousFeed.
export function creativeMatchesCatalogQuery(ad: ProductAd, query: string): boolean {
  const types = resolveCatalogTypes(query);
  if (!types) return false;
  const t = (ad.product as { type?: string | null } | null | undefined)?.type;
  if (!t) return false;
  return types.includes(t);
}

// Returns product tiles whose type matches the synonym set for the given
// query. Used by the consumer feed to render existing catalogs synchronously
// without waiting on the nl-search semantic pipeline.
//
// Sourced from the products table directly, same visibility contract as
// getHomeFeed: is_active = true AND primary_video_url IS NOT NULL, then the
// shopper-gender post-filter. A product with no primary video is never a
// tile — "no primary video → not on the feed" holds here too. is_elite is NOT
// required (when a user asks for "shoes" we want the whole catalog, not just
// the curated default-grid set); it only influences ordering.
export async function getCreativesByCatalogTag(query: string): Promise<ProductAd[]> {
  if (!supabase) return [];
  const key = query.trim().toLowerCase();
  const types = resolveCatalogTypes(key);
  if (!types || types.length === 0) return [];

  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_TILE_SELECT)
    .eq('is_active', true)
    .not('primary_video_url', 'is', null)
    .in('type', types)
    .order('is_elite',                   { ascending: false, nullsFirst: false })
    .order('primary_video_generated_at', { ascending: false, nullsFirst: false })
    .order('created_at',                 { ascending: false })
    .limit(60);

  if (error) {
    console.warn('[getCreativesByCatalogTag] query error:', error.message);
    return [];
  }
  const keywords = CATALOG_KEYWORD_FILTER[key];
  const rows = (data || []) as ProductTileRow[];
  return rows
    .filter(p => passesGenderFilter({ gender: p.gender }))
    // For material queries (denim, leather, wool, …) only keep products whose
    // name actually contains the material keyword - prevents returning all
    // Pants/Jackets when the user searched "denim".
    .filter(p => {
      if (!keywords) return true;
      const name = (p.name ?? '').toLowerCase();
      return keywords.some(k => name.includes(k));
    })
    .map(p => productTileToAd(p, 'catalog'));
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
  // free up (see promoteQueuedAds below - called from the client poll loop).
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
  // `.select()` returns the rows actually deleted. An RLS denial removes
  // zero rows WITHOUT raising an error, so we treat an empty result as a
  // failure — otherwise the tile vanishes optimistically then comes back
  // on refresh with no signal to the admin.
  const { data, error } = await supabase
    .from('product_creative')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: 'Nothing was deleted — you may not have permission (RLS).' };
  }
  return { error: null };
}

/** Delete an entire product from the catalog. Cascades through every
 *  creative that references it (the FK has ON DELETE CASCADE in the
 *  product_creative schema), so this is the heavy hammer the consumer
 *  feed's super-admin long-press uses to nuke a product end-to-end. */
export async function deleteProduct(id: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  // Defensive cleanup first - explicitly drop every creative referencing
  // this product so we never end up with orphan rows even if the FK
  // cascade isn't set up on a given env.
  await supabase.from('product_creative').delete().eq('product_id', id);
  // Hard-delete the product row and confirm it actually went. An RLS
  // denial (e.g. a missing DELETE policy) deletes zero rows and returns
  // no error, which previously looked like success but reappeared on
  // refresh — surface that as an explicit failure instead.
  const { data, error } = await supabase
    .from('products')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: 'Product was not deleted — check your super-admin permissions.' };
  }
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
  // Match the brand case-insensitively + ignore stray whitespace so a
  // product carrying "Alo Yoga" still resolves rows tagged "alo yoga"
  // or "ALO YOGA". ilike with no wildcards is an exact case-insensitive
  // match - safer than ilike '%brand%' which would over-match (e.g.
  // "Alo Yoga" would match "Alo Yoga Athletic").
  //
  // Sourced from the products table directly (same contract as getHomeFeed:
  // is_active + primary_video_url present) so the brand strip / brand page
  // only ever surface products that have a primary video — one product, one
  // tile, no creative-only rows.
  const normalizedBrand = brand.trim();
  let query = supabase
    .from('products')
    .select(PRODUCT_TILE_SELECT)
    .eq('is_active', true)
    .not('primary_video_url', 'is', null)
    .ilike('brand', normalizedBrand)
    .order('is_elite',                   { ascending: false, nullsFirst: false })
    .order('primary_video_generated_at', { ascending: false, nullsFirst: false })
    .order('created_at',                 { ascending: false })
    .limit(fetchLimit);
  if (excludeProductId) query = query.neq('id', excludeProductId);
  const { data, error } = await query;
  if (error) {
    console.warn('[getCreativesByBrand] query error:', error.message);
    return [];
  }
  const rows = (data || []) as ProductTileRow[];
  return rows
    .filter(p => passesGenderFilter({ gender: p.gender }))
    .map(p => productTileToAd(p, 'brand'))
    .slice(0, limit);
}

// Brand fast-path for the search bar. When the user types an exact brand
// name (case- and whitespace-insensitive - "James Perse", "james perse",
// and "JAMES  PERSE" all match the same canonical brand), short-circuit
// the semantic search pipeline and surface every live creative for that
// brand instead.
//
// Backed by a one-shot in-memory index of distinct product.brand values,
// hydrated lazily on first call. The list is small (low hundreds) so we
// keep it for the session - brands churn slowly enough that a stale entry
// is harmless: an exact-match miss just falls through to semantic search.
let brandIndex: Map<string, string> | null = null;
let brandIndexPromise: Promise<Map<string, string>> | null = null;

function normalizeBrandKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function ensureBrandIndex(): Promise<Map<string, string>> {
  if (brandIndex) return brandIndex;
  if (brandIndexPromise) return brandIndexPromise;
  if (!supabase) return new Map();
  brandIndexPromise = (async () => {
    const { data, error } = await supabase
      .from('products')
      .select('brand')
      .not('brand', 'is', null);
    if (error) {
      brandIndexPromise = null;
      return new Map<string, string>();
    }
    const map = new Map<string, string>();
    for (const row of (data || []) as Array<{ brand: string | null }>) {
      if (!row.brand) continue;
      const key = normalizeBrandKey(row.brand);
      if (key && !map.has(key)) map.set(key, row.brand);
    }
    brandIndex = map;
    return map;
  })();
  return brandIndexPromise;
}

/** Returns the canonical brand string when `query` is an exact-brand
 *  search (case- and whitespace-insensitive), else null. */
export async function resolveBrandFromQuery(query: string): Promise<string | null> {
  const key = normalizeBrandKey(query);
  if (!key) return null;
  const index = await ensureBrandIndex();
  return index.get(key) ?? null;
}

/** Synchronous variant - only resolves once the brand index has been
 *  warmed by a prior call. Useful in render paths where we don't want to
 *  await before rendering. Returns null on cold-start. */
export function resolveBrandFromQuerySync(query: string): string | null {
  if (!brandIndex) return null;
  const key = normalizeBrandKey(query);
  if (!key) return null;
  return brandIndex.get(key) ?? null;
}

/** Search fast-path: if the query is an exact brand match, return every
 *  live creative for that brand. Returns null when the query isn't a
 *  brand - the caller falls through to the semantic pipeline. */
export async function getCreativesByBrandQuery(
  query: string,
  limit = 60,
): Promise<ProductAd[] | null> {
  const brand = await resolveBrandFromQuery(query);
  if (!brand) return null;
  return getCreativesByBrand(brand, null, limit);
}

// Look up creatives (with playable video) for an arbitrary set of product
// UUIDs. Used by the consumer feed to surface video ads for products that
// nl-search returned but which aren't in the curated `is_elite` rotation.
// Falls back gracefully - products with no creative simply drop out.
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

// ── Product "Similar" (description-embedding path) ───────────────────────
// Seeds from products.embedding — the 384-dim gte-small TEXT embedding of the
// enriched description — the same signal the feed search uses. Backed by the
// find_similar_products RPC (migration 020), which is type-gated and reads
// ONLY public.products, so it never touches the search edge function.
//
// This replaces the old getSimilarCreatives path on the product page: that
// keyed off product_creative.embedding (512-dim Marengo visual vectors) which
// exist for only a handful of creatives, so it was almost always cold-start
// filler. products.embedding is ~99% populated, so this returns genuine
// description-level matches for nearly the whole catalogue.
type SimilarProductRow = {
  id: string;
  name: string | null;
  brand: string | null;
  price: string | null;
  image_url: string | null;
  primary_image_url: string | null;
  primary_video_url: string | null;
  primary_video_poster_url: string | null;
  images: string[] | null;
  url: string | null;
  type: string | null;
  gender: string | null;
  is_elite: boolean | null;
  distance: number;
};

function similarProductRowToAd(p: SimilarProductRow): ProductAd {
  // Mirrors the product-direct tile shape getHomeFeed produces so the
  // renderer (CreativeCard) paints these identically to feed tiles.
  return productTileToAd(p, 'similar');
}

export async function getSimilarProductsByEmbedding(seedProductId: string, k = 18): Promise<ProductAd[]> {
  if (!supabase || !seedProductId) return [];
  // product_similarity_threshold dial (/admin/dials) — see relative-cutoff
  // logic below.
  const similarityThreshold = await ensureProductSimilarityThreshold();
  // Over-fetch to absorb the relative cutoff, the own-brand drop and gender
  // scope the consumer layer applies on top, without leaving the rail short.
  const fetchK = Math.min(k * 5, 100);
  const { data, error } = await supabase.rpc('find_similar_products', { seed_id: seedProductId, k: fetchK, seed_type: null });
  if (error || !data) {
    if (error) console.warn('[getSimilarProductsByEmbedding] rpc error:', error.message);
    return [];
  }
  const rows = data as SimilarProductRow[]; // already ascending distance
  if (rows.length === 0) return [];

  // Gender is a hard rule, independent of distance — apply it FIRST so the
  // relative band below anchors on the nearest match the shopper can actually
  // see (not a hidden one). Carry each row's distance alongside the mapped ad.
  const candidates = rows
    .map(r => ({ ad: similarProductRowToAd(r), distance: r.distance }))
    .filter(c => passesGenderFilter({ gender: c.ad.product?.gender ?? null }));
  if (candidates.length === 0) return [];

  // The product_similarity_threshold dial is AUTHORITATIVE, applied RELATIVE
  // to this product's nearest match rather than as an absolute distance. The
  // cutoff scales off the closest item (candidates[0], smallest cosine dist):
  //
  //   strictMax = nearest_distance ÷ (dial / 100)
  //
  //   dial 0   → no filter (cutoff = ∞), show all K nearest — never empty
  //   dial 60  → keep items within 1.67× the nearest distance (a wider band)
  //   dial 100 → keep items within 1× the nearest distance (tightest — only
  //              the closest matches / ties)
  //
  // Relative anchoring means the band auto-adapts to how tightly a given
  // category clusters, instead of a one-size absolute threshold.
  const dialFrac = similarityThreshold / 100; // 0..1
  const strictMax = dialFrac > 0 ? candidates[0].distance / dialFrac : Infinity;
  const within = candidates.filter(c => c.distance <= strictMax);

  // Minimum fill. A brand's own product line embeds almost identically (a
  // WoodWick candle's nearest neighbour is another WoodWick candle ~0.05
  // away), which pins the anchor so low that the strict band trims genuine
  // cross-brand matches — e.g. a Chesapeake candle at 0.10 falls just outside
  // the band, so "Similar" cycles two WoodWick tiles and a real candle is
  // hidden. When the strict band is sparse, widen to a more generous multiple
  // of the nearest match so the rail fills with real, in-category neighbours,
  // while still dropping true outliers (a houseplant ranked beneath candles
  // sits past 3× and stays out). Everything here is already category-gated by
  // the RPC, so widening never leaks a different category in.
  const MIN_SIMILAR = Math.min(k, 6);
  let chosen = within;
  if (chosen.length < MIN_SIMILAR) {
    const widenedMax = Math.max(strictMax, candidates[0].distance * 3);
    chosen = candidates.filter(c => c.distance <= widenedMax);
  }

  return chosen.slice(0, k).map(c => c.ad);
}

// ── Similar "why" diagnostics (super-admin debug) ────────────────────────
// A read-only mirror of getSimilarProductsByEmbedding that returns every
// internal signal instead of just the final tiles, so a super admin can see
// exactly how the rail was fetched, filtered and ranked. Kept deliberately
// separate from the hot path: the live rail never pays for this, and the two
// can't drift because this re-derives the same anchor / band / widen math.
export interface SimilarCandidateDiag {
  rank: number;            // original RPC order (0 = nearest neighbour)
  id: string;
  name: string | null;
  brand: string | null;
  type: string | null;     // category the RPC gated on
  gender: string | null;
  distance: number;        // pgvector cosine distance from the seed embedding
  passesGender: boolean;   // survives the shopper-gender gate
  withinStrict: boolean;   // inside the dial's strict relative band
  chosen: boolean;         // returned to the rail (post gender + band/widen)
}

export interface SimilarProductDiagnostics {
  ok: boolean;
  seedProductId: string;
  shopperGender: string;
  threshold: number;        // product_similarity_threshold dial, 0–100
  dialFrac: number;         // threshold / 100
  fetchK: number;           // rows requested from the RPC
  requestedK: number;       // final rail size we slice to
  rawCount: number;         // rows the RPC returned
  genderPassCount: number;  // rows surviving the gender gate
  anchorDistance: number | null; // nearest gender-passing distance
  strictMax: number;        // strict band cutoff (Infinity when dial = 0)
  minSimilar: number;       // sparse-band trigger count
  widened: boolean;         // did the 3× sparse widen kick in
  widenedMax: number | null;
  chosenCount: number;
  candidates: SimilarCandidateDiag[];
}

export async function getSimilarProductsDiagnostics(
  seedProductId: string,
  k = 18,
): Promise<SimilarProductDiagnostics> {
  const empty: SimilarProductDiagnostics = {
    ok: false, seedProductId, shopperGender, threshold: 0, dialFrac: 0,
    fetchK: 0, requestedK: k, rawCount: 0, genderPassCount: 0,
    anchorDistance: null, strictMax: Infinity, minSimilar: Math.min(k, 6),
    widened: false, widenedMax: null, chosenCount: 0, candidates: [],
  };
  if (!supabase || !seedProductId) return empty;

  const threshold = await ensureProductSimilarityThreshold();
  const fetchK = Math.min(k * 5, 100);
  const { data, error } = await supabase.rpc('find_similar_products', { seed_id: seedProductId, k: fetchK, seed_type: null });
  if (error || !data) return { ...empty, threshold, dialFrac: threshold / 100, fetchK };

  const rows = (data as SimilarProductRow[]) || [];
  // Same ordering of gates the live path uses: gender first, then the
  // dial-relative band anchored on the nearest VISIBLE (gender-passing) row.
  const genderPass = rows.filter(r => passesGenderFilter({ gender: r.gender }));
  const anchorDistance = genderPass.length > 0 ? genderPass[0].distance : null;
  const dialFrac = threshold / 100;
  const strictMax = dialFrac > 0 && anchorDistance != null ? anchorDistance / dialFrac : Infinity;

  const within = genderPass.filter(r => r.distance <= strictMax);
  const minSimilar = Math.min(k, 6);
  const widened = within.length < minSimilar && genderPass.length > 0;
  const widenedMax = widened && anchorDistance != null
    ? Math.max(strictMax, anchorDistance * 3)
    : null;

  const cutoff = widened && widenedMax != null ? widenedMax : strictMax;
  const chosenIds = new Set(
    genderPass.filter(r => r.distance <= cutoff).slice(0, k).map(r => r.id),
  );

  const candidates: SimilarCandidateDiag[] = rows.map((r, i) => ({
    rank: i,
    id: r.id,
    name: r.name,
    brand: r.brand,
    type: r.type,
    gender: r.gender,
    distance: r.distance,
    passesGender: passesGenderFilter({ gender: r.gender }),
    withinStrict: r.distance <= strictMax,
    chosen: chosenIds.has(r.id),
  }));

  return {
    ok: true,
    seedProductId,
    shopperGender,
    threshold,
    dialFrac,
    fetchK,
    requestedK: k,
    rawCount: rows.length,
    genderPassCount: genderPass.length,
    anchorDistance,
    strictMax,
    minSimilar,
    widened,
    widenedMax,
    chosenCount: chosenIds.size,
    candidates,
  };
}

/** Idempotent prefetch for the description-embedding "Similar" rail, keyed by
 *  PRODUCT id (not creative id). Safe to call from hover, tap, or open. */
export function prefetchSimilarProducts(seedProductId: string, k = 18): Promise<ProductAd[]> {
  if (!seedProductId) return Promise.resolve([] as ProductAd[]);
  const key = `${seedProductId}|${k}`;
  const cached = similarProductCache.get(key);
  if (cached) return cached;
  const p = getSimilarProductsByEmbedding(seedProductId, k);
  similarProductCache.set(key, p);
  p.catch(() => similarProductCache.delete(key));
  return p;
}

// Impression batching. The consumer feed mounts ~50 CreativeCards at once
// and each fires its own impression RPC the moment the card enters the
// pre-viewport band - that's 50 individual Supabase requests inside the
// first 1–2 s of page load, fighting for the same connection pool as the
// looks fetch and the videos. Coalescing into one flush per ~1 s window
// dedupes scroll-spam (a card flickering across the IO threshold during
// fast scroll) and gives the browser breathing room.
//
// One bulk RPC per flush collapses those N increments into a SINGLE request
// (one radio wakeup, one connection) — see migration
// 20260606140000_bulk_product_creative_impressions. Falls back to the per-id
// RPC when the bulk function isn't deployed yet, so the client is safe to ship
// ahead of the migration and never double-counts (a failed bulk does nothing).

const impressionQueue = new Map<string, number>();
let flushTimer: number | null = null;

function flushImpressionsPerId(ids: string[]) {
  if (!supabase) return;
  // Parallel issue. .catch swallows so a single network failure doesn't
  // kill the rest of the flush.
  for (const id of ids) {
    supabase.rpc('increment_product_creative_impressions', { creative_id: id })
      .then(() => undefined, () => undefined);
  }
}

function flushImpressions() {
  flushTimer = null;
  if (!supabase || impressionQueue.size === 0) return;
  const ids = [...impressionQueue.keys()];
  impressionQueue.clear();
  // One request for the whole batch; fall back to N per-id calls if the bulk
  // function is missing (error) or the call rejects (network).
  supabase.rpc('increment_product_creative_impressions_bulk', { creative_ids: ids })
    .then(
      ({ error }: { error: { message: string } | null }) => { if (error) flushImpressionsPerId(ids); },
      () => flushImpressionsPerId(ids),
    );
}

export function trackAdImpression(id: string): void {
  if (!supabase) return;
  // First time we see this id in the current window - queue it. Repeat
  // sightings within the same window are no-ops.
  if (impressionQueue.has(id)) return;
  impressionQueue.set(id, Date.now());
  if (flushTimer == null && typeof window !== 'undefined') {
    flushTimer = window.setTimeout(flushImpressions, 1000);
  }
}

// Best-effort flush on tab close so impressions queued in the last <1 s
// don't get lost. sendBeacon is the only API that survives unload, but
// it requires a fixed URL - fall back to a synchronous fetch if not
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
