import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useSearchParams } from '@remix-run/react';
import { searchSuggestions } from '~/data/looks';
import { supabase } from '~/utils/supabase';
import {
  researchProducts,
  brainstormCatalogProducts,
  type ResearchedProduct,
  type BrainstormedProduct,
  type ProductGender,
} from '~/services/product-research';
import { getFeedSearchResults, getFeedSearchDiagnostics } from '~/services/feed-search';
import SimilarDebugModal, { buildFeedSearchReport, type SimilarDebugReport } from '~/components/SimilarDebugModal';
import DailyFeedPreview from '~/components/admin/DailyFeedPreview';
import { useAuth } from '~/hooks/useAuth';
import type { ProductAd } from '~/services/product-creative';
import { getShopperGender, setShopperGender, subscribeToShopperGender } from '~/services/product-creative';
import {
  getHomeCatalog,
  updateCatalogToggles,
  setCatalogGender,
  setCatalogFeatured,
  setCatalogSortOrder,
  getCatalogSearchCounts,
  type Catalog as CatalogService,
  type CatalogSearchCounts,
} from '~/services/catalogs';

type CatalogGenderUI = 'all' | 'women' | 'men' | 'unisex';

export interface Catalog {
  id: string;
  name: string;
  source: 'featured' | 'custom' | 'live';
  createdAt: string;
  isHome?: boolean;
  isFeatured?: boolean;
  filterGender?: boolean;
  filterAge?: boolean;
  boostTopConverting?: boolean;
  gender?: CatalogGenderUI;
  sortOrder?: number | null;
  slug?: string;
}

// Slugify a human-typed catalog name the same way ensure_catalog() does in
// migration 021: lowercase, non-alphanum → hyphens, trim hyphens from ends.
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// CSV cell escape: wrap any cell containing a comma, quote, or
// newline in double-quotes; double-up any internal quotes.
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportCatalogsCSV(
  catalogs: { name: string; source: string; createdAt: string; gender?: string; filterAge?: boolean; boostTopConverting?: boolean }[],
  productCounts: Map<string, number>,
  impressions: Map<string, { curr: number; prev: number }>,
  searches: Map<string, CatalogSearchCounts>,
) {
  const header = [
    'name', 'source', 'gender', 'products',
    'impressions_7d', 'impressions_prev_7d', 'impressions_trend_pct',
    'searches_7d', 'searches_total',
    'boost_top_converting', 'created_at',
  ];
  const rows = catalogs.map(c => {
    const key = c.name.toLowerCase();
    const imp = impressions.get(key);
    const trend = imp && imp.prev > 0
      ? Math.round(((imp.curr - imp.prev) / imp.prev) * 100)
      : '';
    const sc = searches.get(key);
    return [
      c.name, c.source, c.gender ?? 'all',
      productCounts.get(c.name) ?? 0,
      imp?.curr ?? 0, imp?.prev ?? 0, trend,
      sc?.count7d ?? 0, sc?.countTotal ?? 0,
      c.boostTopConverting ? '1' : '0',
      c.createdAt && c.createdAt !== ' - ' ? new Date(c.createdAt).toISOString() : '',
    ];
  });
  const body = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `catalogs-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface ProductRow {
  id: string;
  name: string | null;
  brand: string | null;
  image_url: string | null;
  primary_image_url: string | null;
  /** Set when the per-SKU polished i2v clip is available. We expose it as
   *  a sortable "Video" column in the Add Products picker — admins want to
   *  prioritize products that already have video over still-image ones. */
  primary_video_url?: string | null;
  /** Discounted_price or regular price string ("$29.99"). Kept as text
   *  because that's how Shopify hands it to us; sorted numerically by
   *  stripping non-digits in the comparator. */
  price?: string | null;
  /** Taxonomy bucket ("Top", "Shoes", "Dress"…). Used by the picker's
   *  Type column + intent gates in nl-search. */
  type?: string | null;
  gender: string | null;
  catalog_tags: string[] | null;
  createdAt?: string | null;
  metrics?: ItemMetrics;
}

export interface LookRow {
  id: string;
  legacyId: number | null;
  title: string | null;
  creatorHandle: string | null;
  videoPath: string | null;
  /** Picker exposes a 320-tall video preview when present (videoUrl is the
   *  primary creative's clip). thumbnailUrl is the poster fallback. */
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  createdAt?: string | null;
  catalog_tags: string[];
}

export interface CatalogLookRow {
  id: string;
  legacyId: number | null;
  title: string;
  videoPath: string | null;
  creatorHandle: string | null;
  creatorName: string | null;
  creatorAvatarUrl: string | null;
  productCount: number;
  createdAt?: string | null;
  gender?: string | null;
  metrics?: ItemMetrics;
}

export interface CatalogCreativeVideo {
  id: string;
  productId: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  productImageUrl: string | null;
  title: string | null;
  productName: string | null;
  productBrand: string | null;
  status: string;
  metrics?: ItemMetrics;
}

export interface CatalogCreativePayload {
  looks: CatalogLookRow[];
  products: ProductRow[];
  creatives: CatalogCreativeVideo[];
  feedResults: CatalogCreativeVideo[];
}

const ALL_CATALOG_NAME = 'all';
const HOME_CATALOG_NAME = 'home';
// The signed-out landing screen — a second pinned LANDING SCREEN row.
// Guests all see one shared feed, so this catalog is the place to stage
// and inspect exactly that (universe view, like home).
const GUEST_HOME_SLUG = 'guest-home';
const GUEST_HOME_CATALOG_NAME = 'home for unregistered users';
const ALL_ORDER_KEY = 'catalog_admin_all_order';

type CatalogSection = 'looks' | 'creatives' | 'products';

export function isAllCatalog(name: string) {
  return name.trim().toLowerCase() === ALL_CATALOG_NAME;
}

function isHomeCatalog(name: string) {
  return name.trim().toLowerCase() === HOME_CATALOG_NAME;
}

function isGuestHomeCatalog(name: string) {
  return name.trim().toLowerCase() === GUEST_HOME_CATALOG_NAME;
}

// "Universe" view: catalogs that should show every live look/product
// rather than only the rows whose catalog_tags contain the catalog
// name. Both `all` (admin meta-catalog) and `home` (consumer landing
// feed) qualify — the consumer home feed is unfiltered, so admins
// should see the same universe of candidates when triaging.
export function isUniverseCatalog(name: string) {
  return isAllCatalog(name) || isHomeCatalog(name) || isGuestHomeCatalog(name);
}

// Phase 1 RPC payload + derived per-item metrics. Keyed by either the
// look/product UUID (string form) — same key shape the RPC returns.
export interface ItemMetrics {
  impressions: number;
  clicks: number;
  clickouts: number;
  impressionsPrev: number;
  ctr: number;            // clicks ÷ impressions (current window)
  clickoutRate: number;   // clickouts ÷ impressions
  trendPct: number | null; // % change in impressions vs prior window; null if no prior signal
}

// Sort + filter chip vocabulary for the dropdown control bar (Phase 5).
type MetricSort = 'most-viewed' | 'highest-ctr' | 'biggest-riser' | 'biggest-faller' | 'newest' | 'never-viewed';
type MetricFilter = 'all' | 'rising' | 'falling' | 'zombie' | 'never-viewed';

// Drag-reorder of looks/products inside the All / Home catalogs is
// stored locally — there's no canonical sort_order column for the
// universe view since it's synthesized. We cap each section at a
// reasonable count + budget the serialized blob so we never exceed
// localStorage's ~5MB quota (which previously crashed the page on
// catalogs that hit hundreds of products).
const ALL_ORDER_MAX_PER_SECTION = 500;
const ALL_ORDER_MAX_BLOB_BYTES = 256 * 1024; // 256 KB hard ceiling

function loadAllOrder(): Record<CatalogSection, string[]> {
  if (typeof window === 'undefined') return { looks: [], creatives: [], products: [] };
  try {
    const raw = localStorage.getItem(ALL_ORDER_KEY);
    if (!raw) return { looks: [], creatives: [], products: [] };
    const parsed = JSON.parse(raw) as Partial<Record<CatalogSection, string[]>>;
    return {
      looks: parsed.looks || [],
      creatives: parsed.creatives || [],
      products: parsed.products || [],
    };
  } catch {
    return { looks: [], creatives: [], products: [] };
  }
}

function saveAllOrder(order: Record<CatalogSection, string[]>) {
  if (typeof window === 'undefined') return;
  // Trim each section to the max and budget the total payload so we
  // never hit QuotaExceededError. If even the trimmed blob exceeds the
  // ceiling, drop the key entirely (the universe view falls back to
  // its default sort instead of crashing the page).
  const trim = (arr: string[]) => arr.slice(0, ALL_ORDER_MAX_PER_SECTION);
  const trimmed: Record<CatalogSection, string[]> = {
    looks:     trim(order.looks),
    creatives: trim(order.creatives),
    products:  trim(order.products),
  };
  try {
    const blob = JSON.stringify(trimmed);
    if (blob.length > ALL_ORDER_MAX_BLOB_BYTES) {
      try { localStorage.removeItem(ALL_ORDER_KEY); } catch { /* ignore */ }
      return;
    }
    localStorage.setItem(ALL_ORDER_KEY, blob);
  } catch {
    // Quota exceeded or storage disabled — drop the saved order so the
    // page keeps working. Loses the custom ordering for this session
    // but never takes the page down.
    try { localStorage.removeItem(ALL_ORDER_KEY); } catch { /* ignore */ }
  }
}

// Interleaved FEED order — a single ordered list of `${type}:${id}` keys
// so looks and products can be drag-reordered together (the unified Feed
// section). Stored globally (the feed reorder is for the universe/home
// view) with the same quota guards as saveAllOrder.
const FEED_ORDER_KEY = 'catalog-admin:feed-order:v1';
const FEED_ORDER_MAX = 800;
function loadFeedOrder(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(FEED_ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}
function saveFeedOrder(keys: string[]) {
  if (typeof window === 'undefined') return;
  try {
    const blob = JSON.stringify(keys.slice(0, FEED_ORDER_MAX));
    if (blob.length > ALL_ORDER_MAX_BLOB_BYTES) { try { localStorage.removeItem(FEED_ORDER_KEY); } catch { /* ignore */ } return; }
    localStorage.setItem(FEED_ORDER_KEY, blob);
  } catch { try { localStorage.removeItem(FEED_ORDER_KEY); } catch { /* ignore */ } }
}

function applyOrder<T>(items: T[], idKey: (item: T) => string, savedIds: string[]): T[] {
  if (savedIds.length === 0) return items;
  const byId = new Map(items.map(i => [idKey(i), i]));
  const ordered: T[] = [];
  const seen = new Set<string>();
  for (const id of savedIds) {
    const match = byId.get(id);
    if (match && !seen.has(id)) {
      ordered.push(match);
      seen.add(id);
    }
  }
  for (const item of items) {
    const id = idKey(item);
    if (!seen.has(id)) ordered.push(item);
  }
  return ordered;
}

function reorderArray<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return items;
  const next = items.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

// Build the creative payload (looks / products / creatives / feed search
// results) for a single catalog. This is the shared loader behind both
// the inline expandable dropdown on the catalogs table AND the dedicated
// catalog detail page, so both surfaces show identical content.
//
// Data model: looks/products are matched by their `catalog_tags` array
// (universe catalogs — `all` / `home` — pull every live row instead),
// NOT the catalog_looks/catalog_products junction tables. Pass
// `allProducts` to filter an in-memory product list (table view), or
// omit it to have the loader query products itself (detail page).
export async function loadCatalogCreativePayload(
  catalog: { id: string; name: string },
  opts: {
    allProducts?: ProductRow[];
    metricFor?: (targetType: 'look' | 'product', primary: string, secondary?: string | number | null) => ItemMetrics | undefined;
    applyAllOrdering?: boolean;
  } = {},
): Promise<CatalogCreativePayload> {
  const empty: CatalogCreativePayload = { looks: [], products: [], creatives: [], feedResults: [] };
  if (!supabase) return empty;

  const metricFor = opts.metricFor ?? (() => undefined);
  const isAll = isAllCatalog(catalog.name);
  const isUniverse = isUniverseCatalog(catalog.name);

  // Looks: universe catalogs (all / home) pull every live look so admins
  // can browse the entire active set; other catalogs filter by catalog_tags.
  //
  // NOTE: `looks` has NO foreign key to `profiles`, so the creator profile
  // CANNOT be embedded via PostgREST. A `profiles!looks_user_id_fkey`
  // embed 400s the entire request — which silently returned zero looks
  // for every universe catalog ("Looks 0" even though looks existed). We
  // fetch the creator profiles in a second query and merge by user_id.
  let looksQuery = supabase
    .from('looks')
    .select(`
      id, legacy_id, title, creator_handle, user_id, status, enabled, archived_at, created_at, gender,
      looks_creative!inner ( video_url, is_primary ),
      look_products ( product_id )
    `)
    .eq('status', 'live')
    .eq('enabled', true)
    .is('archived_at', null)
    .eq('looks_creative.is_primary', true)
    .order('created_at', { ascending: false });
  if (!isUniverse) {
    looksQuery = looksQuery.contains('catalog_tags', [catalog.name]);
  }
  const { data: lookRows, error: looksError } = await looksQuery;
  if (looksError) console.error('[loadCatalogCreativePayload] looks query error:', looksError.message);

  // Resolve creator names/avatars separately (no FK → no embed).
  const lookUserIds = Array.from(new Set(
    ((lookRows as { user_id: string | null }[] | null) || [])
      .map(r => r.user_id)
      .filter((x): x is string => !!x),
  ));
  const profilesById = new Map<string, { full_name: string | null; avatar_url: string | null }>();
  if (lookUserIds.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url')
      .in('id', lookUserIds);
    for (const p of (profs as { id: string; full_name: string | null; avatar_url: string | null }[] | null) || []) {
      profilesById.set(p.id, { full_name: p.full_name ?? null, avatar_url: p.avatar_url ?? null });
    }
  }

  type LookPayload = {
    id: string;
    legacy_id: number | null;
    title: string;
    creator_handle: string | null;
    user_id: string | null;
    created_at: string | null;
    gender: string | null;
    looks_creative: { video_url: string | null; is_primary: boolean }[] | null;
    look_products: { product_id: string }[] | null;
  };
  const mappedLooks: CatalogLookRow[] = ((lookRows as LookPayload[] | null) || []).map(r => {
    const prof = r.user_id ? profilesById.get(r.user_id) : undefined;
    return {
      id: r.id,
      legacyId: r.legacy_id,
      title: r.title,
      videoPath: r.looks_creative?.[0]?.video_url ?? null,
      creatorHandle: r.creator_handle,
      creatorName: prof?.full_name ?? null,
      creatorAvatarUrl: prof?.avatar_url ?? null,
      productCount: (r.look_products || []).length,
      createdAt: r.created_at,
      gender: r.gender,
      metrics: metricFor('look', r.id, r.legacy_id),
    };
  });

  // Universe view collapses dupes by primary creative video; named
  // catalogs keep every row.
  const looks = isUniverse
    ? Array.from(new Map(mappedLooks.map(l => [l.videoPath ?? l.id, l])).values())
    : mappedLooks;

  // Products: universe catalogs use the whole product set; others filter
  // by catalog_tags. Use the supplied in-memory list when present,
  // otherwise query directly so the loader is self-contained.
  let catalogProductsBase: ProductRow[];
  // An empty-but-defined allProducts (the product library hasn't finished
  // loading yet — a load-order race) must NOT short-circuit to "0 products";
  // fall through to the direct query so the Home/universe feed still loads
  // its products. This was the intermittent "we lost the products" bug.
  if (opts.allProducts && opts.allProducts.length > 0) {
    catalogProductsBase = isUniverse
      ? opts.allProducts
      : opts.allProducts.filter(p => (p.catalog_tags || []).includes(catalog.name));
  } else {
    let productsQuery = supabase
      .from('products')
      .select('id, name, brand, image_url, primary_image_url, gender, catalog_tags');
    if (!isUniverse) {
      productsQuery = productsQuery.contains('catalog_tags', [catalog.name]);
    }
    const { data: productRows } = await productsQuery;
    catalogProductsBase = (productRows as ProductRow[] | null) || [];
  }
  const catalogProducts = catalogProductsBase.map(p => ({
    ...p,
    metrics: metricFor('product', p.id),
  }));

  // Creative videos (product_creative). Universe catalogs pull every
  // rendered ad; named catalogs filter to ads whose product is tagged.
  const catalogProductIds = new Set(catalogProducts.map(p => p.id));
  let adsQuery = supabase
    .from('product_creative')
    .select('id, product_id, title, video_url, thumbnail_url, status, products!inner(id, name, brand, image_url)')
    .not('video_url', 'is', null)
    .in('status', ['done', 'live'])
    .order('created_at', { ascending: false });
  if (!isUniverse) {
    adsQuery = adsQuery.in(
      'product_id',
      catalogProducts.length > 0 ? catalogProducts.map(p => p.id) : ['00000000-0000-0000-0000-000000000000'],
    );
  }
  const { data: adRows } = await adsQuery;

  type AdPayload = {
    id: string;
    product_id: string;
    title: string | null;
    video_url: string;
    thumbnail_url: string | null;
    status: string;
    products: { id: string; name: string | null; brand: string | null; image_url: string | null } | null;
  };
  const creatives: CatalogCreativeVideo[] = ((adRows as unknown as AdPayload[] | null) || [])
    .filter(r => isAll || catalogProductIds.has(r.product_id))
    .map(r => ({
      id: r.id,
      productId: r.product_id,
      videoUrl: r.video_url,
      thumbnailUrl: r.thumbnail_url,
      productImageUrl: r.products?.image_url ?? null,
      metrics: metricFor('product', r.product_id),
      title: r.title,
      productName: r.products?.name ?? null,
      productBrand: r.products?.brand ?? null,
      status: r.status,
    }));

  // Feed search results — same pipeline the consumer feed runs when a
  // user types this catalog name in the search bar. Skipped for the
  // synthetic `all` row and on failure.
  let feedResults: CatalogCreativeVideo[] = [];
  if (!isAll) {
    try {
      const feedAds = await getFeedSearchResults(catalog.name);
      feedResults = feedAds
        .filter(a => !!a.video_url)
        .map(a => ({
          id: a.id,
          productId: a.product_id,
          videoUrl: a.video_url as string,
          thumbnailUrl: a.thumbnail_url,
          title: a.title,
          productName: a.product?.name ?? null,
          productBrand: a.product?.brand ?? null,
          productImageUrl: a.product?.image_url ?? null,
          status: a.status,
        }));
    } catch (err) {
      console.warn('[loadCatalogCreativePayload] feed search failed:', err);
    }
  }

  // Merge products surfaced by feed search so catalogs whose items don't
  // yet have catalog_tags still populate the Products section.
  let displayProducts: ProductRow[] = catalogProducts;
  if (!isAll && feedResults.length > 0) {
    const existingIds = new Set(catalogProducts.map(p => p.id));
    const feedProductIds = [...new Set(feedResults.map(f => f.productId).filter(Boolean))]
      .filter(id => !existingIds.has(id));
    if (feedProductIds.length > 0) {
      let feedOnlyProducts: ProductRow[];
      if (opts.allProducts && opts.allProducts.length > 0) {
        feedOnlyProducts = opts.allProducts.filter(p => feedProductIds.includes(p.id));
      } else {
        const { data: feedProductRows } = await supabase
          .from('products')
          .select('id, name, brand, image_url, primary_image_url, gender, catalog_tags')
          .in('id', feedProductIds);
        feedOnlyProducts = (feedProductRows as ProductRow[] | null) || [];
      }
      if (feedOnlyProducts.length > 0) {
        displayProducts = [
          ...catalogProducts,
          ...feedOnlyProducts.map(p => ({ ...p, metrics: metricFor('product', p.id) })),
        ];
      }
    }
  }

  if (isUniverse && opts.applyAllOrdering) {
    const order = loadAllOrder();
    return {
      looks: applyOrder(looks, l => l.id, order.looks),
      creatives: applyOrder(creatives, c => c.id, order.creatives),
      products: applyOrder(displayProducts, p => p.id, order.products),
      feedResults,
    };
  }

  return { looks, products: displayProducts, creatives, feedResults };
}

export default function AdminCatalogs() {
  const [custom, setCustom] = useState<Catalog[]>([]);
  const [homeCatalog, setHomeCatalog] = useState<CatalogService | null>(null);
  // Daily-feed lens: while an admin is viewing the feed AS a user, the
  // baseline dropdown hides — no two shoppers see that exact order.
  // The signed-out landing screen row (slug guest-home) — pinned under home.
  const [guestCatalog, setGuestCatalog] = useState<Catalog | null>(null);
  const [searchCounts, setSearchCounts] = useState<Map<string, CatalogSearchCounts>>(new Map());
  // Per-catalog impression counts keyed by lowercased name (matches
  // how the consumer feed fires the event — see ContinuousFeed's
  // catalog impression effect). { curr, prev } enables trend in the
  // column.
  const [catalogImpressions, setCatalogImpressions] = useState<Map<string, { curr: number; prev: number }>>(new Map());
  // Per-catalog 14-day daily impressions for the inline sparkline
  // column. One batch fetch keyed by lower(name). Each value is the
  // full 14-day series with zeros filled.
  const [catalogDaily, setCatalogDaily] = useState<Map<string, number[]>>(new Map());

  // Drag-reorder STATE only. The handlers are declared further down
  // — after loadCatalogs / showToast — to keep the useCallback deps
  // array within their TDZ-safe scope (referencing a useCallback
  // declared later in the same function body would TDZ here).
  const [dragSlug, setDragSlug] = useState<string | null>(null);
  const [dropTargetSlug, setDropTargetSlug] = useState<string | null>(null);
  // rankable is computed downstream this render; the handler reads
  // it via this ref, updated AFTER the rankable computation.
  const rankableRef = useRef<Catalog[]>([]);
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      // Hydrate the session so the admin-gated RPC sees auth.uid().
      await supabase.auth.getSession();
      const { data, error } = await supabase.rpc('catalog_view_counts_daily', { window_days: 14 });
      if (cancelled || error || !data) return;
      type Row = { catalog_key: string; day: string; impressions: number | string };
      // Bucket by catalog_key.
      const byKey = new Map<string, Map<string, number>>();
      for (const r of data as Row[]) {
        const inner = byKey.get(r.catalog_key) ?? new Map<string, number>();
        inner.set(r.day, Number(r.impressions) || 0);
        byKey.set(r.catalog_key, inner);
      }
      // Build the 14-day series for each catalog with zeros filled.
      const today = new Date();
      const days: string[] = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(today.getTime() - i * 86400_000);
        days.push(d.toISOString().slice(0, 10));
      }
      const out = new Map<string, number[]>();
      byKey.forEach((dayMap, key) => {
        out.set(key, days.map(d => dayMap.get(d) ?? 0));
      });
      setCatalogDaily(out);
    })().catch(() => {});
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      await supabase.auth.getSession();
      const { data, error } = await supabase.rpc('catalog_view_counts', { window_days: 7 });
      if (cancelled || error || !data) return;
      type Row = { catalog_key: string; impressions_curr: number | string; impressions_prev: number | string };
      const map = new Map<string, { curr: number; prev: number }>();
      for (const r of data as Row[]) {
        map.set(r.catalog_key, { curr: Number(r.impressions_curr) || 0, prev: Number(r.impressions_prev) || 0 });
      }
      setCatalogImpressions(map);
    })().catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [autoTagging, setAutoTagging] = useState(false);
  const [autoTagProgress, setAutoTagProgress] = useState<{ done: number; total: number } | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const loadCatalogs = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('catalogs')
      .select('id, slug, name, created_at, gender, sort_order, is_featured, status, is_home, filter_gender, filter_age, boost_top_converting')
      .eq('is_featured', false)
      .eq('status', 'live')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('loadCatalogs failed:', error.message);
      return;
    }
    if (data) {
      const rows = data as {
        id: string; name: string; slug: string; created_at: string;
        gender: CatalogGenderUI | null;
        sort_order: number | null;
        is_featured: boolean | null;
        is_home: boolean; filter_gender: boolean; filter_age: boolean; boost_top_converting: boolean;
      }[];
      // Home catalog goes into its own state slot; all others fill `custom`.
      const homeRow = rows.find(r => r.is_home);
      const guestRow = rows.find(r => r.slug === GUEST_HOME_SLUG);
      const regularRows = rows.filter(r => !r.is_home && r.slug !== GUEST_HOME_SLUG);

      setCustom(regularRows.map(r => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        source: 'custom' as const,
        createdAt: r.created_at,
        gender: (r.gender ?? 'all') as CatalogGenderUI,
        sortOrder: r.sort_order,
        isFeatured: r.is_featured === true,
        filterGender: r.filter_gender,
        filterAge: r.filter_age,
        boostTopConverting: r.boost_top_converting,
      })));

      if (homeRow) {
        // Reuse the service shape so toggle handlers can call updateCatalogToggles.
        setHomeCatalog(prev => ({
          id: homeRow.id,
          slug: homeRow.slug ?? 'home',
          name: homeRow.name,
          description: null,
          themePrompt: null,
          gender: ((homeRow as { gender?: string | null }).gender as 'all' | 'men' | 'women' | 'unisex' | null) ?? 'all',
          coverUrl: null,
          sortOrder: -1,
          isFeatured: homeRow.is_featured === true,
          status: 'live' as const,
          isHome: true,
          filterGender: homeRow.filter_gender,
          filterAge: homeRow.filter_age,
          boostTopConverting: homeRow.boost_top_converting,
          ...(prev ? {} : {}),
        }));
      } else {
        // Not yet seeded — try a dedicated fetch (needed if migration not applied yet).
        getHomeCatalog().then(h => setHomeCatalog(h));
      }

      if (guestRow) {
        setGuestCatalog({
          id: guestRow.id,
          name: guestRow.name,
          slug: guestRow.slug ?? GUEST_HOME_SLUG,
          source: 'custom' as const,
          createdAt: guestRow.created_at,
          gender: (guestRow.gender ?? 'all') as CatalogGenderUI,
          sortOrder: guestRow.sort_order,
          isFeatured: guestRow.is_featured === true,
          filterGender: guestRow.filter_gender,
          filterAge: guestRow.filter_age,
          boostTopConverting: guestRow.boost_top_converting,
        });
      }

      // Batch-fetch search counts for every catalog name now visible.
      const names = [
        ...(homeRow ? [homeRow.name] : []),
        ...regularRows.map(r => r.name),
      ];
      if (names.length > 0) {
        getCatalogSearchCounts(names).then(counts => {
          setSearchCounts(new Map(counts.map(c => [c.catalogName.toLowerCase(), c])));
        }).catch(() => {});
      }
    }
  }, []);

  useEffect(() => { loadCatalogs(); }, [loadCatalogs]);

  // Realtime search activity. Every search_logs INSERT is a live shopper
  // query — we bump the per-name search count in the existing
  // searchCounts map AND surface unmatched queries as synthetic rows
  // at the top of the table (see liveOnlySearches below). Combined,
  // the admin sees the activity stream materialising into the table
  // without a refresh.
  //
  // Tracking lastSearchedAt lets us sort matched catalogs to the top
  // when their term is being searched — admins curating a catalog see
  // it light up the moment a shopper asks for it.
  const [searchActivity, setSearchActivity] = useState<Map<string, { count: number; lastAt: number }>>(new Map());
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    // Seed: the most recent N searches across the whole platform so
    // the table opens already showing live demand instead of waiting
    // for the next insert to land.
    void (async () => {
      const { data } = await supabase!
        .from('search_logs')
        .select('query, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (cancelled || !data) return;
      const seed = new Map<string, { count: number; lastAt: number }>();
      (data as Array<{ query: string; created_at: string }>).forEach(r => {
        const key = (r.query || '').trim().toLowerCase();
        if (!key) return;
        const ms = new Date(r.created_at).getTime();
        const prev = seed.get(key);
        if (!prev) seed.set(key, { count: 1, lastAt: ms });
        else seed.set(key, { count: prev.count + 1, lastAt: Math.max(prev.lastAt, ms) });
      });
      setSearchActivity(seed);
    })();
    const channel = supabase
      .channel('catalogs-search-activity')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'search_logs' }, (payload) => {
        const row = payload.new as { query?: string | null; created_at?: string };
        const key = (row.query || '').trim().toLowerCase();
        if (!key) return;
        const ms = row.created_at ? new Date(row.created_at).getTime() : Date.now();
        setSearchActivity(prev => {
          const next = new Map(prev);
          const cur = next.get(key);
          next.set(key, {
            count: (cur?.count ?? 0) + 1,
            lastAt: Math.max(cur?.lastAt ?? 0, ms),
          });
          return next;
        });
      })
      .subscribe();
    return () => {
      cancelled = true;
      if (channel) void supabase!.removeChannel(channel);
    };
  }, []);

  // Pre-open the Add Catalog modal when /admin/search links here with ?new=<term>.
  // Lets admins jump straight from a zero-result search to creating that catalog.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const term = searchParams.get('new');
    if (term && term.trim()) {
      setNewName(term.trim());
      setShowAdd(true);
      // Strip the param so a refresh / back-nav doesn't re-open the modal.
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Drag-reorder handlers. Declared HERE — after loadCatalogs and
  // showToast — so the useCallback deps don't TDZ. Moving these
  // before their referenced bindings was the actual cause of the
  // production "Cannot access 'je' before initialization" 500.
  const handleRowDragStart = useCallback((slug: string) => {
    setDragSlug(slug);
  }, []);
  const handleRowDragOver = useCallback((slug: string, e: React.DragEvent) => {
    e.preventDefault();
    if (slug !== dropTargetSlug) setDropTargetSlug(slug);
  }, [dropTargetSlug]);
  const handleRowDrop = useCallback(async (overSlug: string) => {
    const source = dragSlug;
    setDragSlug(null);
    setDropTargetSlug(null);
    if (!source || source === overSlug) return;
    const order = rankableRef.current.map(c => c.slug || '');
    const fromIdx = order.indexOf(source);
    const toIdx = order.indexOf(overSlug);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = order.splice(fromIdx, 1);
    order.splice(toIdx, 0, moved);
    setCustom(prev => prev.map(c => {
      const idx = order.indexOf(c.slug || '');
      return idx >= 0 ? { ...c, sortOrder: idx } : c;
    }));
    const ok = await setCatalogSortOrder(order.filter(Boolean));
    if (!ok) {
      showToast('Could not save order — reverting');
      loadCatalogs();
    }
  }, [dragSlug, loadCatalogs, showToast]);

  const loadProducts = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from('products')
      .select('id, name, brand, image_url, primary_image_url, primary_video_url, price, type, gender, catalog_tags, created_at');
    if (data) {
      // Surface created_at as createdAt so the picker can sort by Added date
      // without reaching back into the raw DB column name.
      setProducts((data as Array<ProductRow & { created_at?: string | null }>).map(p => ({
        ...p,
        createdAt: p.created_at ?? null,
      })));
    }
  }, []);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  // Library of looks for the "+ Add Looks" picker. Only pulls live,
  // enabled, non-archived rows — same filter the consumer feed uses —
  // so the picker doesn't show drafts or removed content. Catalog
  // assignment is stored in looks.catalog_tags (jsonb array, mirrors
  // the products.catalog_tags shape — see migration 021).
  const [looks, setLooks] = useState<LookRow[]>([]);
  const loadLooks = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from('looks')
      .select(`
        id, legacy_id, title, creator_handle, catalog_tags, created_at,
        looks_creative ( video_url, thumbnail_url, is_primary )
      `)
      .eq('status', 'live')
      .eq('enabled', true)
      .is('archived_at', null)
      .order('created_at', { ascending: false });
    if (!data) return;
    type LookPayload = {
      id: string;
      legacy_id: number | null;
      title: string | null;
      creator_handle: string | null;
      catalog_tags: string[] | null;
      created_at: string | null;
      looks_creative: { video_url: string | null; thumbnail_url: string | null; is_primary: boolean }[] | null;
    };
    const mapped: LookRow[] = (data as LookPayload[]).map(r => {
      // Pick the primary creative (or first available) for both the video
      // preview and the poster fallback — same lookup the consumer feed uses.
      const primary = r.looks_creative?.find(c => c.is_primary) ?? r.looks_creative?.[0] ?? null;
      return {
        id: r.id,
        legacyId: r.legacy_id,
        title: r.title,
        creatorHandle: r.creator_handle,
        videoPath: primary?.video_url ?? null,
        videoUrl: primary?.video_url ?? null,
        thumbnailUrl: primary?.thumbnail_url ?? null,
        createdAt: r.created_at,
        catalog_tags: Array.isArray(r.catalog_tags) ? r.catalog_tags : [],
      };
    });
    setLooks(mapped);
  }, []);

  useEffect(() => { loadLooks(); }, [loadLooks]);

  // Phase 1 client wiring: per-item analytics map keyed by
  // `${target_type}:${target_key}`. Powers per-tile pills (Phase 3),
  // trend arrows (Phase 4), and sort/filter (Phase 5). One fetch per
  // session — cheap because the RPC is a single grouped aggregation
  // over a covered time-range index.
  const [metricsByKey, setMetricsByKey] = useState<Map<string, ItemMetrics>>(new Map());
  const [metricsLoading, setMetricsLoading] = useState(false);
  const METRIC_WINDOW_DAYS = 7;

  const loadMetrics = useCallback(async () => {
    if (!supabase) return;
    setMetricsLoading(true);
    try {
      // catalog_item_metrics is SECURITY DEFINER and gates on the
      // caller's admin role via auth.uid(). On a cold mount the Supabase
      // session often isn't attached to the client yet, so the RPC fired
      // unauthenticated, raised 'Admin privileges required', got
      // swallowed, and left every metric column blank ("—") with no
      // retry. Force session hydration first, then retry a few times so
      // the metrics land once auth is ready.
      await supabase.auth.getSession();
      type Row = {
        target_type: string;
        target_key: string;
        impressions_curr: number | string;
        clicks_curr: number | string;
        clickouts_curr: number | string;
        impressions_prev: number | string;
        clicks_prev: number | string;
        clickouts_prev: number | string;
      };
      let data: Row[] | null = null;
      let lastErr: string | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await supabase.rpc('catalog_item_metrics', { window_days: METRIC_WINDOW_DAYS });
        if (!res.error) { data = res.data as Row[] | null; lastErr = null; break; }
        lastErr = res.error.message;
        await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
      }
      if (lastErr) {
        console.warn('[catalog-metrics] rpc failed after retries:', lastErr);
        return;
      }
      const next = new Map<string, ItemMetrics>();
      for (const r of (data || [])) {
        const impressions = Number(r.impressions_curr) || 0;
        const clicks = Number(r.clicks_curr) || 0;
        const clickouts = Number(r.clickouts_curr) || 0;
        const impressionsPrev = Number(r.impressions_prev) || 0;
        const ctr = impressions > 0 ? clicks / impressions : 0;
        const clickoutRate = impressions > 0 ? clickouts / impressions : 0;
        // Trend is null when there's no prior signal — UI shows "new"
        // rather than a misleading "+∞%". When prior > 0 and curr = 0
        // we surface -100% as "fell off the cliff."
        const trendPct = impressionsPrev > 0
          ? Math.round(((impressions - impressionsPrev) / impressionsPrev) * 100)
          : (impressions > 0 ? null : 0);
        next.set(`${r.target_type}:${r.target_key}`, {
          impressions, clicks, clickouts, impressionsPrev, ctr, clickoutRate, trendPct,
        });
      }
      setMetricsByKey(next);
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  useEffect(() => { loadMetrics(); }, [loadMetrics]);

  // Phase 9: live monitoring. Subscribe to user_events INSERT stream
  // via Supabase Realtime so impressions/clicks/clickouts tick up in
  // place while the admin watches. Two side effects:
  //   1. metricsByKey: increment the matching look/product row's
  //      curr-window counts so the per-tile pills and trend stay live.
  //   2. catalogImpressions: increment the matching catalog row's
  //      impressions count so the column updates without refresh.
  // liveTick increments on every accepted event so the "Live"
  // indicator can pulse + a small recent-event counter can render.
  const [liveTick, setLiveTick] = useState(0);
  const [liveActive, setLiveActive] = useState(false);
  // Pulse one specific catalog row briefly when a realtime event
  // lands on it (catalog impression OR a look/product whose catalog
  // we can infer via the tags map). Cleared 700ms later so a steady
  // stream of events produces a steady-strobe effect.
  const [pulseRowId, setPulseRowId] = useState<string | null>(null);
  const pulseTimerRef = useRef<number | null>(null);
  const triggerPulse = useCallback((catalogRowId: string) => {
    setPulseRowId(catalogRowId);
    if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => setPulseRowId(null), 700);
  }, []);
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel('admin-catalogs-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'user_events' },
        (payload) => {
          const row = payload.new as {
            target_type: string | null;
            target_id: string | null;
            target_uuid: string | null;
            event_type: string | null;
          };
          if (!row?.event_type) return;
          const key = row.target_uuid ?? row.target_id;
          if (!key) return;

          if (row.target_type === 'look' || row.target_type === 'product') {
            setMetricsByKey(prev => {
              const k = `${row.target_type}:${key}`;
              const existing = prev.get(k);
              if (!existing) return prev;
              const next = new Map(prev);
              const delta: Partial<ItemMetrics> = {};
              if (row.event_type === 'impression') delta.impressions = existing.impressions + 1;
              if (row.event_type === 'click' || row.event_type === 'clickout') delta.clicks = existing.clicks + 1;
              if (row.event_type === 'clickout') delta.clickouts = existing.clickouts + 1;
              const merged: ItemMetrics = { ...existing, ...delta };
              merged.ctr = merged.impressions > 0 ? merged.clicks / merged.impressions : 0;
              merged.clickoutRate = merged.impressions > 0 ? merged.clickouts / merged.impressions : 0;
              merged.trendPct = merged.impressionsPrev > 0
                ? Math.round(((merged.impressions - merged.impressionsPrev) / merged.impressionsPrev) * 100)
                : (merged.impressions > 0 ? null : 0);
              next.set(k, merged);
              return next;
            });
            setLiveTick(t => t + 1);
          } else if (row.target_type === 'catalog' && row.event_type === 'impression') {
            const cKey = (key || '').toLowerCase();
            setCatalogImpressions(prev => {
              const existing = prev.get(cKey) ?? { curr: 0, prev: 0 };
              const next = new Map(prev);
              next.set(cKey, { ...existing, curr: existing.curr + 1 });
              return next;
            });
            // Pulse the matching row if it's in the rendered list.
            // We don't have id-by-name here at definition time, so we
            // do a quick DOM lookup via the data attribute — same
            // pattern the health-card jump uses.
            requestAnimationFrame(() => {
              const row = document.querySelector(`[data-catalog-row][data-catalog-name="${cKey}"]`);
              const id = row?.getAttribute('data-catalog-row');
              if (id) triggerPulse(id);
            });
            setLiveTick(t => t + 1);
          }
        },
      )
      .subscribe((status) => {
        setLiveActive(status === 'SUBSCRIBED');
      });
    return () => {
      void supabase!.removeChannel(channel);
    };
  }, []);

  // Lookup that tries both target_uuid form (newer events) and the
  // legacy_id form (legacy clients used the integer id). Look rows
  // expose both; product rows always use uuid.
  const metricFor = useCallback((targetType: 'look' | 'product', primary: string, secondary?: string | number | null): ItemMetrics | undefined => {
    const m = metricsByKey;
    return m.get(`${targetType}:${primary}`)
      ?? (secondary != null ? m.get(`${targetType}:${secondary}`) : undefined);
  }, [metricsByKey]);

  // Expandable creative dropdown per catalog row.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creativeByCatalog, setCreativeByCatalog] = useState<Record<string, CatalogCreativePayload>>({});
  const [creativeLoading, setCreativeLoading] = useState<Set<string>>(new Set());

  const loadCreative = useCallback(async (catalog: Catalog) => {
    if (!supabase) return;
    setCreativeLoading(prev => new Set(prev).add(catalog.id));
    try {
      const payload = await loadCatalogCreativePayload(catalog, {
        allProducts: products,
        metricFor,
        applyAllOrdering: true,
      });
      setCreativeByCatalog(prev => ({ ...prev, [catalog.id]: payload }));
    } finally {
      setCreativeLoading(prev => {
        const next = new Set(prev);
        next.delete(catalog.id);
        return next;
      });
    }
  }, [products, metricFor]);

  // When the metrics map arrives after a dropdown has already rendered,
  // rehydrate the open payloads in place so pills/arrows light up
  // without forcing the admin to collapse + re-expand.
  useEffect(() => {
    if (metricsByKey.size === 0) return;
    setCreativeByCatalog(prev => {
      const next: Record<string, CatalogCreativePayload> = { ...prev };
      let changed = false;
      for (const [catalogId, payload] of Object.entries(prev)) {
        const looks = payload.looks.map(l => ({ ...l, metrics: metricFor('look', l.id, l.legacyId) }));
        const products = payload.products.map(p => ({ ...p, metrics: metricFor('product', p.id) }));
        next[catalogId] = { ...payload, looks, products };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [metricsByKey, metricFor]);

  const reorderAllSection = useCallback((catalogId: string, section: CatalogSection, fromIndex: number, toIndex: number) => {
    setCreativeByCatalog(prev => {
      const current = prev[catalogId];
      if (!current) return prev;
      const next = { ...current };
      if (section === 'looks') next.looks = reorderArray(current.looks, fromIndex, toIndex);
      else if (section === 'creatives') next.creatives = reorderArray(current.creatives, fromIndex, toIndex);
      else next.products = reorderArray(current.products, fromIndex, toIndex);

      saveAllOrder({
        looks: next.looks.map(l => l.id),
        creatives: next.creatives.map(c => c.id),
        products: next.products.map(p => p.id),
      });
      return { ...prev, [catalogId]: next };
    });
  }, []);

  const toggleExpanded = useCallback((catalog: Catalog) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(catalog.id)) {
        next.delete(catalog.id);
      } else {
        next.add(catalog.id);
        if (!creativeByCatalog[catalog.id]) {
          loadCreative(catalog);
        }
      }
      return next;
    });
  }, [creativeByCatalog, loadCreative]);

  const featured: Catalog[] = searchSuggestions.map((name, i) => ({
    id: `featured-${i}`,
    name,
    source: 'featured',
    createdAt: ' - ',
  }));

  // The synthetic 'all' row used to live at the top of every table
  // view as an aggregate placeholder. It carried no real metrics
  // (search count, gender mix, product / look counts were all blanks
  // or sums of the rows below) and clicking it didn't open a useful
  // detail. Per spec we drop the row entirely and keep the table to
  // genuine catalogs only. We still filter the literal 'all' name out
  // of `custom` so legacy rows persisted with that name don't sneak
  // back in.
  const customWithoutAll = custom.filter(c => c.name.trim().toLowerCase() !== 'all');

  // Count products tagged with each catalog. Declared HERE (before
  // the table useMemo that depends on it) so the deps array doesn't
  // TDZ in production.
  const catalogProductCounts = useMemo(() => {
    const counts = new Map<string, number>();
    products.forEach(p => {
      (p.catalog_tags || []).forEach(tag => {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      });
    });
    return counts;
  }, [products]);

  // Per-catalog gender mix (male / female / unisex). Replaces the
  // single-row "Gender filter" column with a richer at-a-glance picture
  // of who the catalog actually serves — admins kept asking "is this
  // catalog men-heavy or women-heavy?" and the old gender filter just
  // said "Any". Untagged products contribute to the "—" bucket but
  // aren't surfaced as a tier; the renderer drops them so a fully-
  // untagged catalog reads as empty mix instead of false uniformity.
  const catalogProductGenderMix = useMemo(() => {
    const mix = new Map<string, { male: number; female: number; unisex: number }>();
    products.forEach(p => {
      const g = (p.gender || '').toLowerCase();
      if (g !== 'male' && g !== 'female' && g !== 'unisex') return;
      (p.catalog_tags || []).forEach(tag => {
        const cur = mix.get(tag) || { male: 0, female: 0, unisex: 0 };
        cur[g as 'male' | 'female' | 'unisex'] += 1;
        mix.set(tag, cur);
      });
    });
    return mix;
  }, [products]);

  // Looks tagged per catalog — mirrors catalogProductCounts so the list
  // table can show a Looks count next to Products without expanding each
  // row. Universe catalogs (home / all) show totals instead (handled at
  // the call sites) since they surface every live look regardless of tag.
  const catalogLookCounts = useMemo(() => {
    const counts = new Map<string, number>();
    looks.forEach(l => {
      (l.catalog_tags || []).forEach(tag => {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      });
    });
    return counts;
  }, [looks]);

  // Rank by total search volume so the catalogs shoppers actually care
  // about float to the top. Home is rendered separately above this
  // table so it's already pinned at #1; the synthetic `all` row stays
  // pinned at #2 as the admin meta-view (it would otherwise sink to
  // the bottom with 0 searches). Featured + custom catalogs sort by
  // searchCounts.countTotal desc, with countTotal=0 rows preserving
  // the original order (stable sort keeps recent admin work near the
  // top).
  // Live search count: take the realtime-tracked count from
  // searchActivity (which seeds from the 200 most recent rows + every
  // realtime INSERT) as the source of truth, falling back to the
  // pre-aggregated catalog_search_counts RPC for older history.
  const searchRank = (c: Catalog): number =>
    searchActivity.get(c.name.toLowerCase())?.count
      ?? searchCounts.get(c.name.toLowerCase())?.countTotal
      ?? 0;
  // Last-searched-at recency (ms epoch). Drives the realtime float-to-
  // top behavior — any catalog whose name was just searched bubbles up
  // even when its all-time count is small.
  const lastSearchedAt = (c: Catalog): number =>
    searchActivity.get(c.name.toLowerCase())?.lastAt ?? 0;

  // Per-name search count for the Views column. Prefers the larger of
  // (realtime live count, archived RPC count) so a brand-new live INSERT
  // bumps the cell immediately without waiting for the next reload.
  // For synthetic live-only rows the archived RPC has no entry, so
  // realtime is the only source.
  const mergedSearchCount = (name: string): CatalogSearchCounts | undefined => {
    const key = name.toLowerCase();
    const live = searchActivity.get(key);
    const archived = searchCounts.get(key);
    if (!live && !archived) return undefined;
    // Prefer the live count when it surpasses the archived total — that
    // means a new INSERT landed and we haven't refetched yet.
    const total = Math.max(live?.count ?? 0, archived?.countTotal ?? 0);
    return {
      catalogName: name,
      count24h: Math.max(live?.count ?? 0, archived?.count24h ?? 0),
      count7d:  Math.max(live?.count ?? 0, archived?.count7d  ?? 0),
      countTotal: total,
    };
  };

  // Unmatched live searches: queries the shoppers are typing that
  // don't yet exist as a catalog. Surface them as synthetic rows at
  // the very top of the table so the admin can one-click 'Create
  // catalog' from a real demand signal instead of guessing.
  const existingNames = useMemo(
    () => new Set([...customWithoutAll, ...featured].map(c => c.name.toLowerCase())),
    [customWithoutAll, featured],
  );
  const liveOnlySearches: Catalog[] = useMemo(() => {
    const rows: Array<{ row: Catalog; lastAt: number }> = [];
    searchActivity.forEach((v, key) => {
      if (existingNames.has(key)) return;
      rows.push({
        row: {
          id: `live-${key}`,
          name: key,
          source: 'live',
          createdAt: new Date(v.lastAt).toISOString(),
        },
        lastAt: v.lastAt,
      });
    });
    rows.sort((a, b) => b.lastAt - a.lastAt);
    return rows.map(r => r.row);
  }, [searchActivity, existingNames]);

  // Ranking: pinned catalogs first; then catalogs with recent live
  // search activity sorted by recency desc; then everything else by
  // all-time search count desc. Drag-reorder still updates sort_order
  // for the pin layer.
  const rankable = [...customWithoutAll, ...featured].sort((a, b) => {
    const aPinned = a.sortOrder ?? null;
    const bPinned = b.sortOrder ?? null;
    if (aPinned !== null && bPinned !== null) return aPinned - bPinned;
    if (aPinned !== null) return -1;
    if (bPinned !== null) return 1;
    const aRecent = lastSearchedAt(a);
    const bRecent = lastSearchedAt(b);
    // Hot-zone: catalogs searched in the last 60 seconds float above
    // everything unranked, sorted by recency. Past 60s the recency
    // signal decays and we fall back to all-time count.
    const RECENT_MS = 60_000;
    const now = Date.now();
    const aHot = aRecent > 0 && now - aRecent < RECENT_MS;
    const bHot = bRecent > 0 && now - bRecent < RECENT_MS;
    if (aHot && bHot) return bRecent - aRecent;
    if (aHot) return -1;
    if (bHot) return 1;
    return searchRank(b) - searchRank(a);
  });
  // Live-only synthetic rows go to the very top of every view so the
  // admin sees demand for terms they haven't catalogued yet.
  const rankableWithLive = [...liveOnlySearches, ...rankable];
  const allUnfiltered = rankableWithLive;
  // Sync the drag handler's ref now that `rankable` exists.
  rankableRef.current = rankable;

  // Table-level search + quick filter chips. Operate on the rankable
  // list directly — the synthetic 'all' aggregate row is no longer
  // injected at the top (see comment above customWithoutAll). Empty
  // query + 'all' filter = full list.
  const [tableQuery, setTableQuery] = useState('');
  const [tableFilter, setTableFilter] = useState<'all' | 'rising' | 'falling' | 'empty' | 'zombie' | 'issues'>('all');

  const all = useMemo(() => {
    const q = tableQuery.trim().toLowerCase();
    return rankableWithLive.filter(c => {
      // text match first
      if (q && !c.name.toLowerCase().includes(q)) return false;
      // quick filter predicates
      const imp = catalogImpressions.get(c.name.toLowerCase());
      const sc = searchCounts.get(c.name.toLowerCase());
      const productCount = catalogProductCounts.get(c.name) ?? 0;
      const trendPct = imp && imp.prev > 0 ? ((imp.curr - imp.prev) / imp.prev) * 100 : null;
      switch (tableFilter) {
        case 'rising':  return trendPct !== null && trendPct >= 25;
        case 'falling': return trendPct !== null && trendPct <= -25;
        case 'empty':   return productCount === 0;
        case 'zombie':  return productCount > 0
                             && (!imp || imp.curr === 0)
                             && (!sc || sc.count7d === 0);
        case 'issues':  return productCount === 0
                             || (productCount > 0 && (!imp || imp.curr === 0) && (!sc || sc.count7d === 0))
                             || (trendPct !== null && trendPct <= -50);
        default:        return true;
      }
    });
  }, [rankableWithLive, tableQuery, tableFilter, catalogImpressions, searchCounts, catalogProductCounts]);
  // allUnfiltered powers the dashboard + health panel — they reflect
  // the whole catalog system, not just the in-table filter. `all` is
  // what the table renders.

  const addCatalog = async () => {
    const name = newName.trim();
    if (!name || !supabase) return;
    const slug = slugify(name);
    if (!slug) {
      showToast('Catalog name must have at least one letter or number.');
      return;
    }
    const { error } = await supabase.from('catalogs').upsert(
      {
        slug,
        name,
        is_featured: false,
        status: 'live',
      },
      { onConflict: 'slug' },
    );
    if (error) {
      showToast(`Failed to add catalog: ${error.message}`);
      return;
    }
    await loadCatalogs();
    setNewName('');
    setShowAdd(false);
  };

  const removeCustom = async (id: string) => {
    if (!supabase) return;
    const { error } = await supabase.from('catalogs').delete().eq('id', id);
    if (error) {
      showToast(`Failed to remove catalog: ${error.message}`);
      return;
    }
    await loadCatalogs();
  };

  // Assemble Look modal state
  const [assembleCatalog, setAssembleCatalog] = useState<Catalog | null>(null);
  const [assembling, setAssembling] = useState(false);
  const [assembleResult, setAssembleResult] = useState<{
    title: string;
    description: string;
    style: string;
    prompt: string;
    productIds: string[];
  } | null>(null);
  const [savingLook, setSavingLook] = useState(false);
  const [assembleError, setAssembleError] = useState<string | null>(null);

  const openAssemble = useCallback((catalog: Catalog) => {
    setAssembleCatalog(catalog);
    setAssembleResult(null);
    setAssembleError(null);
  }, []);

  const runAssemble = useCallback(async () => {
    if (!assembleCatalog || !supabase) return;
    const tagged = products.filter(p => (p.catalog_tags || []).includes(assembleCatalog.name));
    if (tagged.length < 3) {
      setAssembleError(`Not enough products tagged with "${assembleCatalog.name}" - need at least 3.`);
      return;
    }
    setAssembling(true);
    setAssembleError(null);
    setAssembleResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('catalog-assemble-look', {
        body: {
          catalog: assembleCatalog.name,
          products: tagged.map(p => ({
            id: p.id,
            name: p.name || '',
            brand: p.brand || '',
            image_url: p.image_url,
          })),
          count: 5,
        },
      });
      if (error) {
        setAssembleError(error.message);
      } else if (!data?.success) {
        setAssembleError(data?.error || 'Assembly failed');
      } else {
        setAssembleResult({
          title: data.title,
          description: data.description,
          style: data.style,
          prompt: data.prompt,
          productIds: data.productIds,
        });
      }
    } catch (err) {
      setAssembleError(err instanceof Error ? err.message : String(err));
    } finally {
      setAssembling(false);
    }
  }, [assembleCatalog, products]);

  const saveAssembledLook = useCallback(async () => {
    if (!assembleCatalog || !assembleResult || !supabase) return;
    setSavingLook(true);
    try {
      const { data: lookRow, error: insertErr } = await supabase
        .from('looks')
        .insert({
          title: assembleResult.title,
          description: assembleResult.description,
          catalog_tags: [assembleCatalog.name],
          status: 'pending',
          enabled: false,
        })
        .select('id')
        .single();
      if (insertErr || !lookRow) {
        setAssembleError(insertErr?.message || 'Failed to save look');
        setSavingLook(false);
        return;
      }
      if (assembleResult.productIds.length > 0) {
        await supabase.from('look_products').insert(
          assembleResult.productIds.map((product_id, sort_order) => ({
            look_id: lookRow.id,
            product_id,
            sort_order,
          }))
        );
      }

      // Kick off Veo video generation - use the hero (first) product as the
      // anchor and feed Claude's assembly_prompt directly so Veo renders the
      // scene Claude imagined.
      const heroProductId = assembleResult.productIds[0];
      if (heroProductId) {
        const styleSlug = assembleResult.style.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        await supabase.from('generated_videos').insert({
          product_id: heroProductId,
          look_id: lookRow.id,
          style: styleSlug || 'lifestyle_context',
          prompt: assembleResult.prompt,
          status: 'pending',
          aspect_ratio: '9:16',
        });
      }

      showToast(`Look "${assembleResult.title}" saved - video queued for generation`);
      setAssembleCatalog(null);
      setAssembleResult(null);
    } catch (err) {
      setAssembleError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingLook(false);
    }
  }, [assembleCatalog, assembleResult, showToast]);

  // Suggest Products modal state
  const [suggestCatalog, setSuggestCatalog] = useState<Catalog | null>(null);
  const [researchQuery, setResearchQuery] = useState('');
  const [researchGender, setResearchGender] = useState<ProductGender | 'all'>('all');
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchResults, setResearchResults] = useState<BrainstormedProduct[]>([]);
  // Hover preview (big thumbnail next to cursor) when scanning research rows.
  const [previewImg, setPreviewImg] = useState<{ url: string; x: number; y: number } | null>(null);
  const [researchSelected, setResearchSelected] = useState<Set<number>>(new Set());
  const [researchLiveOnly, setResearchLiveOnly] = useState(true);
  const [researchSource, setResearchSource] = useState<'live' | 'seed' | null>(null);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [brainstormPhase, setBrainstormPhase] = useState<'idle' | 'brainstorming' | 'searching' | 'done'>('idle');
  const [brainstormQueries, setBrainstormQueries] = useState<string[]>([]);
  const [brainstormProgress, setBrainstormProgress] = useState<{ done: number; total: number } | null>(null);

  const openSuggest = useCallback((catalog: Catalog) => {
    setSuggestCatalog(catalog);
    setResearchQuery(catalog.name);
    setResearchGender('all');
    setResearchResults([]);
    setResearchSelected(new Set());
    setResearchError(null);
    setResearchSource(null);
    setBrainstormQueries([]);
    setBrainstormPhase('idle');
    setBrainstormProgress(null);
  }, []);

  // Add Products modal - pick existing products from the DB and tag them
  // onto a catalog. Persisted by pushing the catalog name into each
  // product's catalog_tags array (same shape the dropdown filter reads).
  const [addProductsCatalog, setAddProductsCatalog] = useState<Catalog | null>(null);
  const [addSearch, setAddSearch] = useState('');
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());
  const [addBusy, setAddBusy] = useState(false);
  const [addAutoPicking, setAddAutoPicking] = useState(false);
  const [addAutoProgress, setAddAutoProgress] = useState<{ done: number; total: number } | null>(null);

  const openAdd = useCallback((catalog: Catalog) => {
    setAddProductsCatalog(catalog);
    setAddSearch('');
    setAddSelected(new Set());
  }, []);

  const closeAdd = useCallback(() => {
    if (addBusy) return;
    setAddProductsCatalog(null);
    setAddSearch('');
    setAddSelected(new Set());
  }, [addBusy]);

  const toggleAddSelected = useCallback((id: string) => {
    setAddSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Auto-pick: ask Claude (via catalog-auto-tag) which of the remaining
  // untagged products belong on this catalog, then tick them in the grid
  // so the admin can review before committing.
  const autoPickRelevant = useCallback(async () => {
    if (!supabase || !addProductsCatalog) return;
    const name = addProductsCatalog.name;
    const candidates = products.filter(p => !(p.catalog_tags || []).includes(name));
    if (candidates.length === 0) {
      showToast('Every product in the library is already in this catalog.');
      return;
    }
    setAddAutoPicking(true);
    setAddAutoProgress({ done: 0, total: candidates.length });
    try {
      const BATCH = 30;
      const CONCURRENCY = 6;
      const batches: ProductRow[][] = [];
      for (let i = 0; i < candidates.length; i += BATCH) batches.push(candidates.slice(i, i + BATCH));

      const picked = new Set<string>();
      let firstError: string | null = null;
      let completed = 0;
      let nextBatch = 0;

      // Worker pool: run up to CONCURRENCY batches in parallel rather than
      // awaiting each sequentially, so wall time scales with numBatches /
      // CONCURRENCY instead of numBatches. Stop scheduling once one errors.
      const worker = async () => {
        while (nextBatch < batches.length && !firstError) {
          const batch = batches[nextBatch++];
          const { data, error } = await supabase!.functions.invoke('catalog-auto-tag', {
            body: {
              products: batch.map(p => ({
                id: p.id,
                name: p.name || '',
                brand: p.brand || '',
                image_url: p.image_url,
              })),
              catalogs: [name],
            },
          });
          if (error) {
            console.error('Auto-pick batch failed:', error);
            if (!firstError) firstError = error.message;
            break;
          }
          if (data?.success && data.results) {
            const results = data.results as Record<string, string[]>;
            for (const [id, tags] of Object.entries(results)) {
              if (tags.includes(name)) picked.add(id);
            }
          }
          completed += batch.length;
          setAddAutoProgress({ done: Math.min(completed, candidates.length), total: candidates.length });
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

      setAddSelected(prev => {
        const next = new Set(prev);
        picked.forEach(id => next.add(id));
        return next;
      });
      if (firstError) {
        showToast(`Auto-pick partially failed: ${firstError}. Picked ${picked.size} so far.`);
      } else {
        showToast(`Picked ${picked.size} relevant product${picked.size === 1 ? '' : 's'}. Review and click Add to commit.`);
      }
    } catch (err) {
      showToast(`Auto-pick failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAddAutoPicking(false);
      setAddAutoProgress(null);
    }
  }, [addProductsCatalog, products, showToast]);

  const commitAdd = useCallback(async () => {
    if (!supabase || !addProductsCatalog || addSelected.size === 0) return;
    setAddBusy(true);
    try {
      const name = addProductsCatalog.name;
      const updates = Array.from(addSelected).map(id => {
        const p = products.find(x => x.id === id);
        const tags = new Set([...(p?.catalog_tags || []), name]);
        return supabase!
          .from('products')
          .update({ catalog_tags: Array.from(tags) })
          .eq('id', id)
          .select('id');
      });
      const results = await Promise.all(updates);
      const errored = results.filter(r => r.error);
      const blocked = results.filter(r => !r.error && (!r.data || r.data.length === 0));
      const succeeded = results.length - errored.length - blocked.length;

      if (errored.length > 0) {
        console.error('[add-products] update errors:', errored.map(r => r.error));
      }
      if (blocked.length > 0) {
        console.warn('[add-products] no rows updated for', blocked.length, 'products - RLS may be blocking writes on public.products');
      }

      if (succeeded === 0) {
        showToast(
          errored.length > 0
            ? `Update failed: ${errored[0].error?.message || 'unknown error'}`
            : `No products were written - check RLS policies on public.products (admin needs UPDATE).`,
        );
      } else if (succeeded < results.length) {
        showToast(`Added ${succeeded} of ${results.length} products to ${name} (${results.length - succeeded} blocked).`);
      } else {
        showToast(`Added ${succeeded} product${succeeded === 1 ? '' : 's'} to ${name}.`);
      }

      if (succeeded > 0) {
        await loadProducts();
        setCreativeByCatalog(prev => {
          const next = { ...prev };
          delete next[addProductsCatalog.id];
          return next;
        });
        setAddProductsCatalog(null);
        setAddSelected(new Set());
        setAddSearch('');
      }
    } finally {
      setAddBusy(false);
    }
  }, [addProductsCatalog, addSelected, products, loadProducts, showToast]);

  // Add Looks modal state - mirrors Add Products. Tags the catalog
  // name into looks.catalog_tags so the consumer feed (which filters
  // by `contains(catalog_tags, [name])`) picks them up.
  const [addLooksCatalog, setAddLooksCatalog] = useState<Catalog | null>(null);
  const [addLooksSearch, setAddLooksSearch] = useState('');
  const [addLooksSelected, setAddLooksSelected] = useState<Set<string>>(new Set());
  const [addLooksBusy, setAddLooksBusy] = useState(false);

  const openAddLooks = useCallback((catalog: Catalog) => {
    setAddLooksCatalog(catalog);
    setAddLooksSearch('');
    setAddLooksSelected(new Set());
  }, []);

  const closeAddLooks = useCallback(() => {
    if (addLooksBusy) return;
    setAddLooksCatalog(null);
    setAddLooksSearch('');
    setAddLooksSelected(new Set());
  }, [addLooksBusy]);

  const toggleAddLookSelected = useCallback((id: string) => {
    setAddLooksSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const commitAddLooks = useCallback(async () => {
    if (!supabase || !addLooksCatalog || addLooksSelected.size === 0) return;
    setAddLooksBusy(true);
    try {
      const name = addLooksCatalog.name;
      const updates = Array.from(addLooksSelected).map(id => {
        const l = looks.find(x => x.id === id);
        const tags = new Set([...(l?.catalog_tags || []), name]);
        return supabase!
          .from('looks')
          .update({ catalog_tags: Array.from(tags) })
          .eq('id', id)
          .select('id');
      });
      const results = await Promise.all(updates);
      const errored = results.filter(r => r.error);
      const blocked = results.filter(r => !r.error && (!r.data || r.data.length === 0));
      const succeeded = results.length - errored.length - blocked.length;

      if (errored.length > 0) {
        console.error('[add-looks] update errors:', errored.map(r => r.error));
      }
      if (blocked.length > 0) {
        console.warn('[add-looks] no rows updated for', blocked.length, 'looks - RLS may be blocking writes on public.looks');
      }

      if (succeeded === 0) {
        showToast(
          errored.length > 0
            ? `Update failed: ${errored[0].error?.message || 'unknown error'}`
            : `No looks were written - check RLS policies on public.looks (admin needs UPDATE).`,
        );
      } else if (succeeded < results.length) {
        showToast(`Added ${succeeded} of ${results.length} looks to ${name} (${results.length - succeeded} blocked).`);
      } else {
        showToast(`Added ${succeeded} look${succeeded === 1 ? '' : 's'} to ${name}.`);
      }

      if (succeeded > 0) {
        await loadLooks();
        // Drop the cached expanded-row payload for this catalog so the
        // dropdown re-fetches with the new looks. We also call
        // loadCreative() immediately — without this, the dropdown is
        // still expanded and would just render empty until the user
        // collapses + re-opens (i.e. the visible bug: "added looks
        // don't show up in the catalog").
        setCreativeByCatalog(prev => {
          const next = { ...prev };
          delete next[addLooksCatalog.id];
          return next;
        });
        await loadCreative(addLooksCatalog);
        setAddLooksCatalog(null);
        setAddLooksSelected(new Set());
        setAddLooksSearch('');
      }
    } finally {
      setAddLooksBusy(false);
    }
  }, [addLooksCatalog, addLooksSelected, looks, loadLooks, loadCreative, showToast]);

  // ── Recommend Looks (Claude curates the library) ──────────────────
  // Asks catalog-recommend-looks to rank which existing library looks
  // best fit this catalog, then opens a review modal where the admin
  // ticks the ones to attach (catalog_tags write, same as Add Looks).
  const [recommendLooksCatalog, setRecommendLooksCatalog] = useState<Catalog | null>(null);
  const [recommendLooksBusy, setRecommendLooksBusy] = useState(false);
  const [recommendLooksError, setRecommendLooksError] = useState<string | null>(null);
  const [recommendLooksResults, setRecommendLooksResults] = useState<{ id: string; reason: string }[]>([]);
  const [recommendLooksSelected, setRecommendLooksSelected] = useState<Set<string>>(new Set());
  const [recommendLooksSaving, setRecommendLooksSaving] = useState(false);

  const openRecommendLooks = useCallback(async (catalog: Catalog) => {
    if (!supabase) return;
    setRecommendLooksCatalog(catalog);
    setRecommendLooksResults([]);
    setRecommendLooksSelected(new Set());
    setRecommendLooksError(null);
    setRecommendLooksBusy(true);
    try {
      // Only recommend looks NOT already in this catalog.
      const candidates = looks.filter(l => !l.catalog_tags.includes(catalog.name));
      if (candidates.length === 0) {
        setRecommendLooksError('Every live look is already in this catalog.');
        setRecommendLooksBusy(false);
        return;
      }
      const { data, error } = await supabase.functions.invoke('catalog-recommend-looks', {
        body: {
          catalog: catalog.name,
          count: 8,
          looks: candidates.map(l => ({
            id: l.id,
            title: l.title,
            creator: l.creatorHandle,
          })),
        },
      });
      if (error) { setRecommendLooksError(error.message); return; }
      if (!data?.success) { setRecommendLooksError(data?.error || 'Recommendation failed'); return; }
      const recs = (data.recommendations || []) as { id: string; reason: string }[];
      setRecommendLooksResults(recs);
      // Pre-select all recommendations so the admin can one-click add.
      setRecommendLooksSelected(new Set(recs.map(r => r.id)));
      if (recs.length === 0) setRecommendLooksError('Claude found no strong matches for this catalog.');
    } catch (err) {
      setRecommendLooksError(err instanceof Error ? err.message : String(err));
    } finally {
      setRecommendLooksBusy(false);
    }
  }, [looks]);

  const commitRecommendLooks = useCallback(async () => {
    if (!supabase || !recommendLooksCatalog || recommendLooksSelected.size === 0) return;
    setRecommendLooksSaving(true);
    try {
      const name = recommendLooksCatalog.name;
      const updates = Array.from(recommendLooksSelected).map(id => {
        const l = looks.find(x => x.id === id);
        const tags = new Set([...(l?.catalog_tags || []), name]);
        return supabase!.from('looks').update({ catalog_tags: Array.from(tags) }).eq('id', id).select('id');
      });
      const results = await Promise.all(updates);
      const succeeded = results.filter(r => !r.error && r.data && r.data.length > 0).length;
      if (succeeded === 0) {
        showToast('No looks were written — check RLS on public.looks.');
      } else {
        showToast(`Added ${succeeded} recommended look${succeeded === 1 ? '' : 's'} to ${name}.`);
        await loadLooks();
        setCreativeByCatalog(prev => { const next = { ...prev }; delete next[recommendLooksCatalog.id]; return next; });
        await loadCreative(recommendLooksCatalog);
        setRecommendLooksCatalog(null);
        setRecommendLooksResults([]);
        setRecommendLooksSelected(new Set());
      }
    } finally {
      setRecommendLooksSaving(false);
    }
  }, [recommendLooksCatalog, recommendLooksSelected, looks, loadLooks, loadCreative, showToast]);

  const closeSuggest = useCallback(() => {
    if (ingesting) return;
    setSuggestCatalog(null);
    setResearchQuery('');
    setResearchResults([]);
    setResearchSelected(new Set());
    setResearchError(null);
  }, [ingesting]);

  const runResearch = useCallback(async () => {
    if (!researchQuery.trim()) return;
    setResearchLoading(true);
    setResearchSelected(new Set());
    setResearchError(null);
    setResearchResults([]);
    setBrainstormQueries([]);
    setBrainstormPhase('brainstorming');
    setBrainstormProgress(null);

    const { queries, products, error, source } = await brainstormCatalogProducts(researchQuery, {
      count: 8,
      onProgress: (p) => {
        setBrainstormPhase(p.phase);
        if (p.queries) setBrainstormQueries(p.queries);
        if (p.completedQueries !== undefined && p.queries) {
          setBrainstormProgress({ done: p.completedQueries, total: p.queries.length });
        }
        if (p.products) setResearchResults(p.products);
      },
    });

    setBrainstormQueries(queries);
    setResearchResults(products);
    setResearchSource(source);
    setResearchError(error);
    setResearchLoading(false);
    setBrainstormPhase('done');
  }, [researchQuery]);

  const ingestSelectedProducts = useCallback(async () => {
    if (!supabase || researchSelected.size === 0) return;
    setIngesting(true);
    const nowIso = new Date().toISOString();
    const rows = Array.from(researchSelected).map(i => {
      const p = researchResults[i];
      return {
        name: p.name,
        brand: p.brand,
        price: p.price,
        url: p.url,
        image_url: p.image_url,
        images: p.image_urls || [p.image_url].filter(Boolean),
        scrape_status: 'done',
        scraped_at: nowIso,
        // Auto-tag with the catalog since these were suggested specifically for it
        catalog_tags: suggestCatalog ? [suggestCatalog.name] : [],
      };
    });
    const { error } = await supabase
      .from('products')
      .insert(rows)
      .select('id');
    setIngesting(false);
    if (!error) {
      showToast(`Added ${rows.length} product${rows.length === 1 ? '' : 's'} from "${suggestCatalog?.name}"`);
      closeSuggest();
      loadProducts();
    } else {
      showToast(`Ingest failed: ${error.message}`);
    }
  }, [researchSelected, researchResults, suggestCatalog, closeSuggest, showToast]);

  const visibleResearchResults = useMemo(() =>
    researchResults.filter(
      p => researchGender === 'all' || p.gender === researchGender || p.gender === 'unisex'
    ),
  [researchResults, researchGender]);

  const runAutoTag = useCallback(async () => {
    if (!supabase || products.length === 0) return;
    const allCatalogs = all.map(c => c.name);
    if (allCatalogs.length === 0) {
      showToast('No catalogs to tag against');
      return;
    }
    setAutoTagging(true);
    setAutoTagProgress({ done: 0, total: products.length });

    try {
      const BATCH = 30;
      let done = 0;
      for (let i = 0; i < products.length; i += BATCH) {
        const batch = products.slice(i, i + BATCH);
        const { data, error } = await supabase.functions.invoke('catalog-auto-tag', {
          body: {
            products: batch.map(p => ({
              id: p.id,
              name: p.name || '',
              brand: p.brand || '',
              image_url: p.image_url,
            })),
            catalogs: allCatalogs,
          },
        });
        if (error) {
          console.error('Auto-tag batch failed:', error);
          break;
        }
        if (data?.success && data.results) {
          // Persist tags in parallel
          const updates = Object.entries(data.results as Record<string, string[]>);
          await Promise.all(
            updates.map(([id, tags]) =>
              supabase!.from('products').update({ catalog_tags: tags }).eq('id', id)
            )
          );
        }
        done += batch.length;
        setAutoTagProgress({ done, total: products.length });
      }
      await loadProducts();
      showToast(`Tagged ${done} product${done === 1 ? '' : 's'}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Auto-tag failed: ${msg}`);
    } finally {
      setAutoTagging(false);
      setAutoTagProgress(null);
    }
  }, [products, all, loadProducts, showToast]);

  return (
    <div className="admin-page">
      <div className="admin-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Catalogs</h1>
          <p className="admin-page-subtitle">Featured catalog ideas that scroll in the suggestor on the main screen</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="admin-btn admin-btn-secondary"
            onClick={runAutoTag}
            disabled={autoTagging || products.length === 0}
            title="Use Claude to tag all products with relevant catalogs"
          >
            {autoTagging && autoTagProgress ? (
              <>Auto-tagging {autoTagProgress.done}/{autoTagProgress.total}…</>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                  <line x1="7" y1="7" x2="7.01" y2="7" />
                </svg>
                Auto-tag with Claude
              </>
            )}
          </button>
          <button
            className="admin-btn admin-btn-secondary"
            onClick={() => exportCatalogsCSV(allUnfiltered, catalogProductCounts, catalogImpressions, searchCounts)}
            title="Download a CSV of every catalog with metrics"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export CSV
          </button>
          {/* Automatic Editor button moved onto the landing-screen (daily feed)
              row — it only governs that personalized feed, so it shouldn't sit
              in the global catalogs toolbar. */}
          <button className="admin-btn admin-btn-primary" onClick={() => setShowAdd(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add new catalog
          </button>
        </div>
      </div>

      {/* Monitor any shopper: search a user and see their live/served Daily
          Feed + the engine's reasoning. Mounted prominently at the top of the
          catalogs page so admins can monitor users from here too. */}
      <div style={{ marginBottom: 24 }}>
        <DailyFeedPreview />
      </div>

      <div style={{ display: 'flex', gap: 20, padding: '10px 0', marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>{all.length}</span>
          <span style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>{featured.length}</span>
          <span style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Featured</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>{custom.length}</span>
          <span style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Custom</span>
        </div>
      </div>

      <LiveIndicator active={liveActive} tick={liveTick} />

      {/* Stripped down per the latest minimal-catalog spec:
            • Insights strip (Impressions 7d / Top catalog / Biggest riser…)
              is removed.
            • Catalog Health panel (zombie / empty / dark inventory cards) is
              removed.
            • Filter chips (Rising / Falling / Empty / Zombie / Has issues)
              are removed from the search bar.
            • Gender column is replaced with a M/W/Unisex ratio.
            • "Searches" column is renamed "Views" so views and searches read
              as the same metric to admins.
          The lookup catalogs themselves (rising/zombie/empty checks) are
          still computed for export & the per-row tooltips, but the page no
          longer surfaces them as a hero panel. */}

      <CatalogsTableSearch
        query={tableQuery}
        onQuery={setTableQuery}
        total={rankable.length}
        showing={all.length - (tableQuery ? 0 : 1)}
      />

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Catalog</th>
              <th>Featured</th>
              {/* Views (= total search count for the catalog's name).
                  Moved here from column 6 so it sits adjacent to
                  Featured — admins curating the Featured column kept
                  asking "is this term actually being searched?" and
                  scrolling 4 columns right was a friction tax. */}
              <th title="Total times a shopper searched this catalog name.">Views</th>
              <th>Mix</th>
              <th>Products</th>
              <th>Looks</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {/* ── Home catalog row ─────────────────────────────────────── */}
            {homeCatalog && (() => {
              const homeAsLocal: Catalog = {
                id: homeCatalog.id,
                name: homeCatalog.name,
                slug: homeCatalog.slug,
                source: 'custom' as const,
                createdAt: ' - ',
                isHome: true,
                filterGender: homeCatalog.filterGender,
                filterAge: homeCatalog.filterAge,
                boostTopConverting: homeCatalog.boostTopConverting,
              };
              const isOpen = expanded.has(homeCatalog.id);
              const creative = creativeByCatalog[homeCatalog.id];
              const isLoadingCreative = creativeLoading.has(homeCatalog.id);
              // Home is universe — show TOTAL products/looks (every live
              // entry), preferring the expanded payload's counts once loaded.
              const homeProductCount = creative?.products.length ?? products.length;
              const homeLookCount = creative?.looks.length ?? looks.length;
              return (
                <React.Fragment key={homeCatalog.id}>
                  <tr
                    data-catalog-row={homeCatalog.id}
                    data-catalog-name={homeCatalog.name.toLowerCase()}
                    style={{
                      background: pulseRowId === homeCatalog.id ? '#dcfce7' : '#fffbeb',
                      boxShadow: 'inset 3px 0 0 #f59e0b',
                      transition: 'background-color 600ms ease',
                    }}
                  >
                    <td style={{ textAlign: 'left', fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          onClick={() => toggleExpanded(homeAsLocal)}
                          aria-label={isOpen ? 'Collapse' : 'Expand'}
                          style={{
                            width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            background: 'transparent', border: '1px solid #e5e7eb', borderRadius: 4,
                            color: '#6b7280', cursor: 'pointer', padding: 0,
                            transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                            transition: 'transform 0.12s ease',
                          }}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </button>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span
                              title="This catalog is what shoppers see when they open the app"
                              style={{
                                padding: '2px 8px',
                                borderRadius: 999,
                                fontSize: 10,
                                fontWeight: 700,
                                background: '#f59e0b',
                                color: '#fff',
                                letterSpacing: '0.4px',
                              }}
                            >
                              ★ LANDING SCREEN
                            </span>
                            <Link to="/admin/catalogs/home" style={{ color: '#111', textDecoration: 'none' }}>Your daily feed</Link>
                            {/* The Daily Feed has its own admin page now — settings,
                                dials, and the per-shopper / per-date preview all live
                                there. This catalog is just its candidate pool +
                                baseline order. See docs/daily-feed.md. */}
                            <Link
                              to="/admin/daily-feed"
                              className="admin-btn admin-btn-secondary"
                              title="Open the Daily Feed page — settings, dials, and shopper preview"
                              style={{ marginLeft: 6, padding: '2px 8px', fontSize: 11, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}>
                                <path d="M3 4h18v18H3zM3 10h18M8 2v4M16 2v4" />
                              </svg>
                              Daily Feed →
                            </Link>
                          </div>
                          <span style={{ fontSize: 10, color: '#92400e', fontWeight: 400 }}>
                            This is what users see first — a personalized daily feed, unique per shopper.
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <FeaturedToggle
                        slug={homeCatalog.slug}
                        value={homeCatalog.isFeatured}
                        onChange={(v) => setHomeCatalog(prev => prev ? { ...prev, isFeatured: v } : prev)}
                        onError={(msg) => showToast(msg)}
                      />
                    </td>
                    <td><SearchCountPill counts={searchCounts.get(homeCatalog.name.toLowerCase())} /></td>
                    <td>
                      <GenderMixCell mix={catalogProductGenderMix.get(homeCatalog.name)} />
                    </td>
                    <td>
                      {homeProductCount > 0 ? (
                        <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#eff6ff', color: '#1d4ed8' }}>{homeProductCount}</span>
                      ) : (
                        <span style={{ fontSize: 11, color: '#ccc' }}> - </span>
                      )}
                    </td>
                    <td>
                      {homeLookCount > 0 ? (
                        <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#f0fdf4', color: '#15803d' }}>{homeLookCount}</span>
                      ) : (
                        <span style={{ fontSize: 11, color: '#ccc' }}> - </span>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: '#888' }}> - </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={7} style={{ padding: '14px 18px', background: '#fafafa', borderTop: 'none', fontSize: 13, color: '#555' }}>
                        The Daily Feed (settings, dials, and the per-shopper /
                        per-date preview) now lives on its own page.{' '}
                        <Link to="/admin/daily-feed" style={{ color: '#1d4ed8', fontWeight: 600 }}>
                          Open Daily Feed →
                        </Link>
                        <div style={{ marginTop: 4, color: '#999' }}>
                          This catalog is the Daily Feed&apos;s candidate pool + baseline order.
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })()}

            {/* ── Pinned: the signed-out landing screen ────────────────── */}
            {guestCatalog && (() => {
              const isOpen = expanded.has(guestCatalog.id);
              const creative = creativeByCatalog[guestCatalog.id];
              const isLoadingCreative = creativeLoading.has(guestCatalog.id);
              return (
                <React.Fragment key={guestCatalog.id}>
                  <tr
                    data-catalog-row={guestCatalog.id}
                    data-catalog-name={guestCatalog.name.toLowerCase()}
                    style={{
                      background: '#eef2ff',
                      boxShadow: 'inset 3px 0 0 #6366f1',
                    }}
                  >
                    <td style={{ textAlign: 'left', fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          onClick={() => toggleExpanded(guestCatalog)}
                          aria-label={isOpen ? 'Collapse' : 'Expand'}
                          style={{
                            width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            background: 'transparent', border: '1px solid #e5e7eb', borderRadius: 4,
                            color: '#6b7280', cursor: 'pointer', padding: 0,
                            transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                            transition: 'transform 0.12s ease',
                          }}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </button>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span
                              title="What signed-out visitors see — one shared landing feed"
                              style={{
                                padding: '2px 8px',
                                borderRadius: 999,
                                fontSize: 10,
                                fontWeight: 700,
                                background: '#6366f1',
                                color: '#fff',
                                letterSpacing: '0.4px',
                              }}
                            >
                              ★ LANDING SCREEN · SIGNED OUT
                            </span>
                            <Link to={`/admin/catalogs/${GUEST_HOME_SLUG}`} style={{ color: '#111', textDecoration: 'none' }}>
                              Home for unregistered users
                            </Link>
                          </div>
                          <span style={{ fontSize: 10, color: '#4338ca', fontWeight: 400 }}>
                            The landing home screen for users who aren&apos;t registered — one shared feed, no personalization.
                          </span>
                        </div>
                      </div>
                    </td>
                    <td><span style={{ fontSize: 11, color: '#ccc' }}> - </span></td>
                    <td><SearchCountPill counts={searchCounts.get(guestCatalog.name.toLowerCase())} /></td>
                    <td>
                      <GenderMixCell mix={catalogProductGenderMix.get(guestCatalog.name)} />
                    </td>
                    <td>
                      <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#eff6ff', color: '#1d4ed8' }}>
                        {creative?.products.length ?? products.length}
                      </span>
                    </td>
                    <td>
                      <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#f0fdf4', color: '#15803d' }}>
                        {creative?.looks.length ?? looks.length}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: '#888' }}> - </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={7} style={{ padding: 0, background: '#fafafa', borderTop: 'none' }}>
                        <CatalogCreativeDropdown
                          isAll={false}
                          isUniverse={true}
                          catalogName={guestCatalog.name}
                          loading={isLoadingCreative}
                          creative={creative}
                          metricsLoading={metricsLoading}
                          catalogNames={all.filter(x => x.name !== guestCatalog.name && !isAllCatalog(x.name)).map(x => x.name)}
                          onReorder={(section, from, to) => reorderAllSection(guestCatalog.id, section, from, to)}
                          onOpenAddLooks={looks.length === 0 ? undefined : () => openAddLooks(guestCatalog)}
                          onOpenAddProducts={products.length === 0 ? undefined : () => openAdd(guestCatalog)}
                          onRecommendProducts={() => openSuggest(guestCatalog)}
                          onRecommendLooks={() => openRecommendLooks(guestCatalog)}
                          onAfterBulkMutation={() => {
                            setCreativeByCatalog(prev => { const next = { ...prev }; delete next[guestCatalog.id]; return next; });
                            loadLooks();
                            loadProducts();
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })()}

            {/* ── Regular catalog rows ─────────────────────────────────── */}
            {all.map(c => {
              // Use expanded-state count (includes feed-derived products) when
            // the row has already been loaded; fall back to the tag-based count.
            const isUni = isUniverseCatalog(c.name);
            const productCount =
              creativeByCatalog[c.id]?.products.length ??
              (isUni ? products.length : catalogProductCounts.get(c.name)) ??
              0;
            // Looks count: expanded payload first, else total for universe
            // catalogs, else the tag-based count for named catalogs.
            const lookCount =
              creativeByCatalog[c.id]?.looks.length ??
              (isUni ? looks.length : catalogLookCounts.get(c.name)) ??
              0;
              const isOpen = expanded.has(c.id);
              const creative = creativeByCatalog[c.id];
              const isLoadingCreative = creativeLoading.has(c.id);
              return (
              <React.Fragment key={c.id}>
              <tr
                data-catalog-row={c.id}
                data-catalog-name={c.name.toLowerCase()}
                draggable={!!c.slug}
                onDragStart={() => c.slug && handleRowDragStart(c.slug)}
                onDragOver={(e) => c.slug && handleRowDragOver(c.slug, e)}
                onDragLeave={() => setDropTargetSlug(null)}
                onDrop={() => c.slug && handleRowDrop(c.slug)}
                onDragEnd={() => { setDragSlug(null); setDropTargetSlug(null); }}
                style={{
                  background: pulseRowId === c.id
                    ? '#dcfce7'
                    : dropTargetSlug === c.slug && dragSlug && dragSlug !== c.slug
                      ? '#dbeafe'
                      : 'transparent',
                  opacity: dragSlug === c.slug ? 0.5 : 1,
                  transition: 'background-color 200ms ease, opacity 120ms',
                  cursor: c.slug ? 'grab' : 'default',
                }}
              >
                <td style={{ textAlign: 'left', fontWeight: 600 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      title="Drag to reorder. Pinned catalogs take priority over search rank."
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        color: c.sortOrder != null ? '#1d4ed8' : '#cbd5e1',
                        cursor: 'grab',
                        userSelect: 'none',
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="9" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/>
                        <circle cx="15" cy="6" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="15" cy="18" r="1.6"/>
                      </svg>
                    </span>
                    <button
                      onClick={() => toggleExpanded(c)}
                      aria-label={isOpen ? 'Collapse creative' : 'Expand creative'}
                      title={isOpen ? 'Hide looks in this catalog' : 'Show looks in this catalog'}
                      style={{
                        width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        background: 'transparent', border: '1px solid #e5e7eb', borderRadius: 4,
                        color: '#6b7280', cursor: 'pointer', padding: 0,
                        transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                        transition: 'transform 0.12s ease',
                      }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                    <Link
                      to={`/admin/catalogs/${c.name.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-')}`}
                      style={{ color: '#111', textDecoration: 'none' }}
                      title="Open detail page - view attached looks + product palette, run auto-assign"
                    >
                      {c.name}
                    </Link>
                  </div>
                </td>
                <td>
                  <FeaturedToggle
                    slug={c.slug}
                    value={c.isFeatured}
                    disabled={c.id === 'synthetic-all'}
                    onChange={(v) => setCustom(prev => prev.map(x => x.id === c.id ? { ...x, isFeatured: v } : x))}
                    onError={(msg) => showToast(msg)}
                  />
                </td>
                <td><SearchCountPill counts={searchCounts.get(c.name.toLowerCase())} /></td>
                <td>
                  <GenderMixCell mix={catalogProductGenderMix.get(c.name)} />
                </td>
                <td>
                  {productCount > 0 ? (
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      background: '#eff6ff',
                      color: '#1d4ed8',
                    }}>
                      {productCount}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: '#ccc' }}> - </span>
                  )}
                </td>
                <td>
                  {lookCount > 0 ? (
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      background: '#f0fdf4',
                      color: '#15803d',
                    }}>
                      {lookCount}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: '#ccc' }}> - </span>
                  )}
                </td>
                <td style={{ fontSize: 12, color: '#888' }}>
                  {c.createdAt === ' - ' ? ' - ' : new Date(c.createdAt).toLocaleDateString()}
                </td>
              </tr>
              {isOpen && (
                <tr>
                  <td colSpan={7} style={{ padding: 0, background: '#fafafa', borderTop: 'none' }}>
                    <CatalogCreativeDropdown
                      isAll={isAllCatalog(c.name)}
                      isUniverse={isUniverseCatalog(c.name)}
                      catalogName={c.name}
                      loading={isLoadingCreative}
                      creative={creative}
                      metricsLoading={metricsLoading}
                      catalogNames={all.filter(x => x.name !== c.name && !isAllCatalog(x.name)).map(x => x.name)}
                      onReorder={(section, from, to) => reorderAllSection(c.id, section, from, to)}
                      // Add/Recommend affordances live inside the LOOKS
                      // and PRODUCTS section headings. Keep only the
                      // catalog-level actions (assemble, remove) in the
                      // top header bar — they don't fit naturally inside
                      // a per-section heading.
                      onOpenAddLooks={looks.length === 0 ? undefined : () => openAddLooks(c)}
                      onOpenAddProducts={products.length === 0 ? undefined : () => openAdd(c)}
                      onRecommendProducts={() => openSuggest(c)}
                      onRecommendLooks={() => openRecommendLooks(c)}
                      headerControls={(
                        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
                          <button className="admin-btn admin-btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => openAssemble(c)} disabled={productCount < 3} title={productCount < 3 ? 'Tag at least 3 products with this catalog first' : 'Claude assembles a look from tagged products'}>✨ Assemble Look</button>
                          {c.source === 'custom' && c.id !== 'synthetic-all' && (
                            <button className="admin-btn admin-btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: '#dc2626' }} onClick={() => removeCustom(c.id)}>✕ Remove catalog</button>
                          )}
                        </div>
                      )}
                      onAfterBulkMutation={() => {
                        // Drop the cached creative payload + refetch
                        // looks/products so the dropdown reflects the
                        // mutation immediately.
                        setCreativeByCatalog(prev => { const next = { ...prev }; delete next[c.id]; return next; });
                        loadLooks();
                        loadProducts();
                      }}
                    />
                  </td>
                </tr>
              )}
              </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div className="admin-modal-overlay" onClick={() => setShowAdd(false)}>
          <div
            className="admin-modal"
            style={{ width: 440, maxWidth: '90vw', padding: 24 }}
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>Add new catalog</h2>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: '#888' }}>
              This will appear in the scrolling catalog suggestor on the main page.
            </p>
            <input
              type="text"
              autoFocus
              placeholder='e.g. "beach day", "quiet luxury"'
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addCatalog(); }}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 6,
                border: '1px solid #ddd',
                fontSize: 13,
                marginBottom: 16,
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="admin-btn admin-btn-secondary" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
              <button
                className="admin-btn admin-btn-primary"
                onClick={addCatalog}
                disabled={!newName.trim()}
              >
                Add catalog
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Products modal - pick from existing library */}
      {addProductsCatalog && (
        <AddProductsModal
          catalog={addProductsCatalog}
          products={products}
          search={addSearch}
          onSearch={setAddSearch}
          selected={addSelected}
          onToggle={toggleAddSelected}
          busy={addBusy}
          autoPicking={addAutoPicking}
          autoProgress={addAutoProgress}
          onAutoPick={autoPickRelevant}
          onClose={closeAdd}
          onCommit={commitAdd}
        />
      )}

      {/* Add Looks modal - pick from existing library */}
      {addLooksCatalog && (
        <AddLooksModal
          catalog={addLooksCatalog}
          looks={looks}
          search={addLooksSearch}
          onSearch={setAddLooksSearch}
          selected={addLooksSelected}
          onToggle={toggleAddLookSelected}
          busy={addLooksBusy}
          onClose={closeAddLooks}
          onCommit={commitAddLooks}
        />
      )}

      {recommendLooksCatalog && (
        <RecommendLooksModal
          catalog={recommendLooksCatalog}
          looks={looks}
          loading={recommendLooksBusy}
          error={recommendLooksError}
          results={recommendLooksResults}
          selected={recommendLooksSelected}
          saving={recommendLooksSaving}
          onToggle={(id) => setRecommendLooksSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
          })}
          onClose={() => { if (!recommendLooksSaving) setRecommendLooksCatalog(null); }}
          onCommit={commitRecommendLooks}
        />
      )}

      {/* Suggest Products modal */}
      {suggestCatalog && (
        <div className="admin-modal-overlay" onClick={closeSuggest}>
          {previewImg && (
            <div
              style={{
                position: 'fixed',
                left: Math.min(previewImg.x, (typeof window !== 'undefined' ? window.innerWidth : 1600) - 280),
                top: Math.max(10, previewImg.y),
                width: 260,
                height: 340,
                borderRadius: 10,
                overflow: 'hidden',
                background: '#111',
                boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
                zIndex: 10000,
                pointerEvents: 'none',
              }}
            >
              <img
                src={previewImg.url}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            </div>
          )}
          <div
            className="admin-modal"
            style={{ width: 720, maxWidth: '92vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '20px 24px 12px' }}>
              <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>
                Suggest Products for "{suggestCatalog.name}"
              </h2>
              <p style={{ margin: '0 0 14px', fontSize: 13, color: '#888' }}>
                Claude brainstorms specific product ideas for this vibe, then searches Google Shopping for each.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  autoFocus
                  placeholder='e.g. "brunch outfit", "quiet luxury", "make me hot"'
                  value={researchQuery}
                  onChange={e => setResearchQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') runResearch(); }}
                  style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}
                />
                <button
                  className="admin-btn admin-btn-primary"
                  onClick={runResearch}
                  disabled={researchLoading || !researchQuery.trim()}
                >
                  {brainstormPhase === 'brainstorming'
                    ? 'Brainstorming…'
                    : brainstormPhase === 'searching' && brainstormProgress
                      ? `Searching ${brainstormProgress.done}/${brainstormProgress.total}…`
                      : researchLoading
                        ? 'Searching…'
                        : 'Suggest'}
                </button>
              </div>
              {brainstormQueries.length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <span style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', alignSelf: 'center' }}>Claude searched:</span>
                  {brainstormQueries.map((q, i) => (
                    <span key={i} style={{
                      padding: '3px 10px',
                      borderRadius: 999,
                      background: '#f1f5f9',
                      border: '1px solid #e2e8f0',
                      fontSize: 11,
                      color: '#475569',
                      fontWeight: 500,
                    }}>
                      {q}
                    </span>
                  ))}
                </div>
              )}
              {researchError && (
                <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12 }}>
                  <strong>Search failed:</strong> {researchError}
                </div>
              )}
              {researchResults.length > 0 && researchSource && (
                <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 999, background: researchSource === 'live' ? '#ecfdf5' : '#fffbeb', border: '1px solid', borderColor: researchSource === 'live' ? '#a7f3d0' : '#fde68a', fontSize: 11, fontWeight: 600, color: researchSource === 'live' ? '#047857' : '#b45309', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: researchSource === 'live' ? '#10b981' : '#f59e0b' }} />
                  {researchSource === 'live' ? 'Live Google Shopping' : 'Seed (offline)'}
                </div>
              )}
              {researchResults.length > 0 && (
                <div style={{ display: 'flex', gap: 12, marginTop: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{researchResults.length}</span>
                      <span style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Products</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#3b82f6' }}>
                        {researchResults.reduce((sum, p) => sum + (p.image_urls?.length || 1), 0)}
                      </span>
                      <span style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Thumbnails pulled</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>For</span>
                    {(['all', 'men', 'women', 'unisex'] as const).map(g => (
                      <button
                        key={g}
                        onClick={() => setResearchGender(g)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 999,
                          border: '1px solid',
                          borderColor: researchGender === g ? '#111' : '#e2e8f0',
                          background: researchGender === g ? '#111' : '#fff',
                          color: researchGender === g ? '#fff' : '#111',
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                          textTransform: 'capitalize',
                        }}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div style={{ flex: 1, overflow: 'auto', padding: '0 24px' }}>
              {researchLoading && researchResults.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: '#999', fontSize: 13 }}>
                  {brainstormPhase === 'brainstorming'
                    ? 'Asking Claude for product ideas…'
                    : brainstormPhase === 'searching' && brainstormProgress
                      ? `Searching Google Shopping for each query (${brainstormProgress.done}/${brainstormProgress.total})…`
                      : 'Searching…'}
                </div>
              ) : researchResults.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: '#999', fontSize: 13 }}>
                  Press Suggest to have Claude brainstorm products for this catalog.
                </div>
              ) : visibleResearchResults.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: '#999', fontSize: 13 }}>
                  No results for that gender.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {visibleResearchResults.map(p => {
                    const idx = researchResults.indexOf(p);
                    const isSelected = researchSelected.has(idx);
                    const scoreColor = p.thumbnailScore >= 85 ? '#16a34a' : p.thumbnailScore >= 70 ? '#ca8a04' : '#dc2626';
                    const scoreLabel = p.thumbnailScore >= 90 ? 'Excellent' : p.thumbnailScore >= 75 ? 'Good' : p.thumbnailScore >= 60 ? 'Fair' : 'Poor';
                    return (
                      <div
                        key={`${p.brand}-${p.name}-${idx}`}
                        onClick={() => {
                          setResearchSelected(prev => {
                            const next = new Set(prev);
                            if (next.has(idx)) next.delete(idx); else next.add(idx);
                            return next;
                          });
                        }}
                        onMouseEnter={e => {
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setPreviewImg({ url: p.image_url, x: r.right + 12, y: r.top });
                        }}
                        onMouseMove={e => {
                          setPreviewImg(prev => prev ? { ...prev, x: e.clientX + 16, y: e.clientY - 80 } : prev);
                        }}
                        onMouseLeave={() => setPreviewImg(null)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                          borderRadius: 8, cursor: 'pointer',
                          background: isSelected ? '#f0f7ff' : 'transparent',
                          border: `1px solid ${isSelected ? '#3b82f6' : '#eee'}`,
                        }}
                      >
                        <div style={{
                          width: 20, height: 20, borderRadius: 4,
                          border: `2px solid ${isSelected ? '#3b82f6' : '#ccc'}`,
                          background: isSelected ? '#3b82f6' : '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                        }}>
                          {isSelected && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                          {(p.image_urls || [p.image_url]).slice(0, 4).map((u, ui) => (
                            <img
                              key={ui}
                              src={u}
                              alt=""
                              onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                              style={{
                                width: ui === 0 ? 48 : 28,
                                height: 48,
                                borderRadius: 6,
                                objectFit: 'cover',
                                background: '#f5f5f5',
                                border: '1px solid #e5e7eb',
                              }}
                            />
                          ))}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{p.name}</div>
                          <div style={{ fontSize: 11, color: '#888' }}>
                            {p.brand} · {p.price} · <span style={{ textTransform: 'capitalize' }}>{p.gender}</span>
                          </div>
                          {p.sourceQuery && (
                            <div style={{ fontSize: 10, color: '#64748b', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                              </svg>
                              <span>{p.sourceQuery}</span>
                            </div>
                          )}
                          <div style={{ fontSize: 10, color: '#3b82f6', marginTop: 2, fontWeight: 600 }}>
                            {(p.image_urls || [p.image_url]).length} thumbnail{((p.image_urls || [p.image_url]).length === 1) ? '' : 's'} pulled
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 11, color: '#888' }}>Thumbnail</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: scoreColor }}>{p.thumbnailScore}</span>
                            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: `${scoreColor}18`, color: scoreColor, fontWeight: 600 }}>{scoreLabel}</span>
                          </div>
                          <div style={{ fontSize: 10, color: '#999' }}>{p.reason}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ padding: '14px 24px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#888' }}>
                {researchSelected.size > 0 ? `${researchSelected.size} selected` : ''}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="admin-btn admin-btn-secondary" onClick={closeSuggest} disabled={ingesting}>
                  Cancel
                </button>
                <button
                  className="admin-btn admin-btn-primary"
                  onClick={ingestSelectedProducts}
                  disabled={ingesting || researchSelected.size === 0}
                >
                  {ingesting ? 'Adding…' : `Add ${researchSelected.size || ''} to Products`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assemble Look modal */}
      {assembleCatalog && (
        <div className="admin-modal-overlay" onClick={() => !assembling && !savingLook && setAssembleCatalog(null)}>
          <div
            className="admin-modal"
            style={{ width: 640, maxWidth: '92vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid #f0f0f0' }}>
              <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>
                ✨ Assemble Look for "{assembleCatalog.name}"
              </h2>
              <p style={{ margin: 0, fontSize: 13, color: '#888' }}>
                Claude picks 5 products tagged with this catalog and writes a look concept ready for video generation.
              </p>
            </div>

            <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
              {!assembleResult && !assembling && !assembleError && (
                <div style={{ textAlign: 'center', padding: '40px 0' }}>
                  <button
                    className="admin-btn admin-btn-primary"
                    onClick={runAssemble}
                  >
                    Let Claude assemble this look
                  </button>
                  <div style={{ marginTop: 10, fontSize: 12, color: '#888' }}>
                    {products.filter(p => (p.catalog_tags || []).includes(assembleCatalog.name)).length} products tagged
                  </div>
                </div>
              )}

              {assembling && (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#888', fontSize: 13 }}>
                  Assembling… Claude is curating the outfit and writing a video concept.
                </div>
              )}

              {assembleError && (
                <div style={{ padding: '10px 14px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12 }}>
                  {assembleError}
                </div>
              )}

              {assembleResult && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Title</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#111' }}>{assembleResult.title}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Description</div>
                    <div style={{ fontSize: 14, color: '#333' }}>{assembleResult.description}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Style</div>
                    <span style={{ padding: '3px 10px', borderRadius: 999, background: '#eff6ff', color: '#1d4ed8', fontSize: 12, fontWeight: 600 }}>
                      {assembleResult.style}
                    </span>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Products ({assembleResult.productIds.length})</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
                      {assembleResult.productIds.map(id => {
                        const p = products.find(x => x.id === id);
                        if (!p) return null;
                        return (
                          <div key={id} style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden', background: '#fff' }}>
                            {p.image_url && (
                              <img src={p.image_url} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
                            )}
                            <div style={{ padding: 6 }}>
                              <div style={{ fontSize: 10, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.brand}</div>
                              <div style={{ fontSize: 11, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Video Prompt</div>
                    <div style={{ fontSize: 12, color: '#444', padding: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                      {assembleResult.prompt}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div style={{ padding: '14px 24px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {assembleResult && (
                  <button
                    className="admin-btn admin-btn-secondary"
                    style={{ fontSize: 12 }}
                    onClick={runAssemble}
                    disabled={assembling || savingLook}
                  >
                    Try another
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="admin-btn admin-btn-secondary"
                  onClick={() => setAssembleCatalog(null)}
                  disabled={assembling || savingLook}
                >
                  Cancel
                </button>
                {assembleResult && (
                  <button
                    className="admin-btn admin-btn-primary"
                    onClick={saveAssembledLook}
                    disabled={savingLook}
                  >
                    {savingLook ? 'Saving…' : 'Save as look'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#111', color: '#fff', padding: '10px 20px', borderRadius: 8,
          fontSize: 13, fontWeight: 500, zIndex: 9999, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

interface CatalogCreativeDropdownProps {
  isAll: boolean;
  isUniverse: boolean;
  catalogName: string;
  loading: boolean;
  creative: CatalogCreativePayload | undefined;
  metricsLoading: boolean;
  /** Other catalog names this row can fan out to via bulk "Add to…". */
  catalogNames: string[];
  onReorder: (section: CatalogSection, fromIndex: number, toIndex: number) => void;
  onAfterBulkMutation: () => void;
  /** Row-level controls (toggles + add/suggest/assemble actions) relocated
   *  from the table columns into the expanded detail header. */
  headerControls?: React.ReactNode;
  /** Per-section "+ Add Looks" / "+ Add Products" + "✨ Recommend"
   *  affordances, surfaced inside the LOOKS and PRODUCTS section
   *  headings (replacing the top headerControls bar). */
  onOpenAddLooks?: () => void;
  onOpenAddProducts?: () => void;
  onRecommendLooks?: () => void;
  onRecommendProducts?: () => void;
}

// ── Phase 10: catalog health panel ────────────────────────────────────
// Synthesizes actionable warnings from the data already in memory.
// Each issue has: severity, count, optional sample catalog names
// (so the admin can jump straight to the worst offenders), and a
// one-line action hint.
interface HealthIssue {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  samples: string[];
  action: string;
}

function CatalogsHealthPanel({
  catalogs,
  impressionsByName,
  searchCountsByName,
  productCountsByName,
  onJumpToCatalog,
}: {
  catalogs: Catalog[];
  impressionsByName: Map<string, { curr: number; prev: number }>;
  searchCountsByName: Map<string, CatalogSearchCounts>;
  productCountsByName: Map<string, number>;
  onJumpToCatalog?: (name: string) => void;
}) {
  const issues = useMemo<HealthIssue[]>(() => {
    const out: HealthIssue[] = [];
    // Skip the synthetic `all` row — it's an admin meta-view, not a
    // real catalog.
    const real = catalogs.filter(c => !isAllCatalog(c.name) && c.id !== 'synthetic-all');

    const empty = real.filter(c => (productCountsByName.get(c.name) ?? 0) === 0);
    if (empty.length > 0) {
      out.push({
        severity: 'warning',
        title: `${empty.length} catalog${empty.length === 1 ? '' : 's'} with no products`,
        detail: 'Shoppers landing here see an empty grid. Tag products via "+ Add Products" or "Suggest Products."',
        samples: empty.slice(0, 4).map(c => c.name),
        action: 'Add products or archive',
      });
    }

    const zombies = real.filter(c => {
      const imp = impressionsByName.get(c.name.toLowerCase());
      const sc = searchCountsByName.get(c.name.toLowerCase());
      const noImpressions = !imp || imp.curr === 0;
      const noSearches = !sc || sc.count7d === 0;
      return noImpressions && noSearches && (productCountsByName.get(c.name) ?? 0) > 0;
    });
    if (zombies.length > 0) {
      out.push({
        severity: 'warning',
        title: `${zombies.length} zombie catalog${zombies.length === 1 ? '' : 's'}`,
        detail: 'Have products tagged but received 0 impressions AND 0 searches in the last 7 days.',
        samples: zombies.slice(0, 4).map(c => c.name),
        action: 'Boost or retire',
      });
    }

    const falling = real
      .map(c => {
        const imp = impressionsByName.get(c.name.toLowerCase());
        if (!imp || imp.prev === 0 || imp.curr === 0) return null;
        const pct = Math.round(((imp.curr - imp.prev) / imp.prev) * 100);
        return pct <= -50 ? { name: c.name, pct } : null;
      })
      .filter((x): x is { name: string; pct: number } => x !== null);
    if (falling.length > 0) {
      out.push({
        severity: 'critical',
        title: `${falling.length} catalog${falling.length === 1 ? '' : 's'} fell off (>50% drop)`,
        detail: 'Impressions collapsed vs the prior 7-day window. Likely a content or ranking regression.',
        samples: falling.slice(0, 4).map(f => `${f.name} (↓${Math.abs(f.pct)}%)`),
        action: 'Investigate',
      });
    }

    const rising = real
      .map(c => {
        const imp = impressionsByName.get(c.name.toLowerCase());
        if (!imp || imp.prev === 0 || imp.curr === 0) return null;
        const pct = Math.round(((imp.curr - imp.prev) / imp.prev) * 100);
        return pct >= 50 ? { name: c.name, pct } : null;
      })
      .filter((x): x is { name: string; pct: number } => x !== null);
    if (rising.length > 0) {
      out.push({
        severity: 'info',
        title: `${rising.length} catalog${rising.length === 1 ? '' : 's'} breaking out (>50% growth)`,
        detail: 'Impressions surging vs the prior 7-day window. Consider promoting on Home or featuring.',
        samples: rising.slice(0, 4).map(r => `${r.name} (↑${r.pct}%)`),
        action: 'Promote',
      });
    }

    // Sweet-spot detection: catalogs with high search volume but
    // missing products. These are the highest-leverage actions an
    // admin can take.
    const demanded = real.filter(c => {
      const sc = searchCountsByName.get(c.name.toLowerCase());
      const productCount = productCountsByName.get(c.name) ?? 0;
      return sc && sc.count7d >= 3 && productCount === 0;
    });
    if (demanded.length > 0) {
      out.push({
        severity: 'critical',
        title: `${demanded.length} high-demand catalog${demanded.length === 1 ? '' : 's'} with no products`,
        detail: 'Shoppers are searching for these but the grid is empty — every search is a dead end.',
        samples: demanded.slice(0, 4).map(c => c.name),
        action: 'Tag products immediately',
      });
    }

    if (out.length === 0) {
      out.push({
        severity: 'info',
        title: 'No critical issues detected',
        detail: 'Every real catalog has products tagged, no >50% drops, no high-demand catalogs sitting empty.',
        samples: [],
        action: 'Keep monitoring',
      });
    }

    return out;
  }, [catalogs, impressionsByName, searchCountsByName, productCountsByName]);

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700, marginBottom: 6 }}>
        Catalog Health
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8 }}>
        {issues.map((issue, idx) => (
          <HealthCard key={idx} issue={issue} onJumpToCatalog={onJumpToCatalog} />
        ))}
      </div>
    </div>
  );
}

function HealthCard({ issue, onJumpToCatalog }: { issue: HealthIssue; onJumpToCatalog?: (name: string) => void }) {
  const palette = {
    critical: { bg: '#fef2f2', border: '#fecaca', accent: '#b91c1c', icon: '⚠' },
    warning:  { bg: '#fffbeb', border: '#fde68a', accent: '#a16207', icon: '⚠' },
    info:     { bg: '#ecfdf5', border: '#a7f3d0', accent: '#047857', icon: '✓' },
  }[issue.severity];
  return (
    <div style={{
      background: palette.bg,
      border: `1px solid ${palette.border}`,
      borderRadius: 8,
      padding: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ color: palette.accent, fontSize: 13, fontWeight: 700 }}>{palette.icon}</span>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', lineHeight: 1.3 }}>{issue.title}</div>
      </div>
      <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.4 }}>{issue.detail}</div>
      {issue.samples.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
          {issue.samples.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onJumpToCatalog?.(s)}
              disabled={!onJumpToCatalog}
              title={onJumpToCatalog ? 'Jump to this catalog' : undefined}
              style={{
                padding: '1px 6px', borderRadius: 4,
                background: 'rgba(255,255,255,0.6)', border: `1px solid ${palette.border}`,
                fontSize: 10, fontWeight: 600, color: palette.accent,
                cursor: onJumpToCatalog ? 'pointer' : 'default',
                fontFamily: 'inherit',
              }}
              onMouseEnter={onJumpToCatalog ? (e) => { (e.currentTarget as HTMLButtonElement).style.background = '#fff'; } : undefined}
              onMouseLeave={onJumpToCatalog ? (e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.6)'; } : undefined}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <div style={{ fontSize: 10, color: palette.accent, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 2 }}>
        → {issue.action}
      </div>
    </div>
  );
}

// ── Phase 9: live indicator ───────────────────────────────────────────
// Pulses on every accepted realtime event; shows total events seen
// this session so admins can confirm the channel is hot.
function LiveIndicator({ active, tick }: { active: boolean; tick: number }) {
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (tick === 0) return;
    setPulse(true);
    const t = window.setTimeout(() => setPulse(false), 500);
    return () => window.clearTimeout(t);
  }, [tick]);
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 10px',
      borderRadius: 999,
      background: active ? '#ecfdf5' : '#f1f5f9',
      border: `1px solid ${active ? '#a7f3d0' : '#e2e8f0'}`,
      marginBottom: 10,
      fontSize: 11,
      fontWeight: 600,
      color: active ? '#047857' : '#64748b',
    }}>
      <span style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: active ? '#10b981' : '#cbd5e1',
        boxShadow: pulse ? '0 0 0 6px rgba(16,185,129,0.25)' : 'none',
        transition: 'box-shadow 200ms ease',
      }} />
      {active ? 'Live' : 'Connecting…'} · {tick} event{tick === 1 ? '' : 's'} this session
    </div>
  );
}

// ── Mix cell ─────────────────────────────────────────────────────────
// Renders the M/W/Unisex composition of a catalog's products as a tiny
// stacked bar + percentage labels. The page-level catalogProductGenderMix
// passes in a {male, female, unisex} count tuple; we normalise to
// percentages and skip rendering when the catalog has zero tagged
// products (so universe catalogs and unscoped tags read as "—").
function GenderMixCell({ mix }: { mix?: { male: number; female: number; unisex: number } }) {
  if (!mix) return <span style={{ fontSize: 11, color: '#cbd5e1' }}>—</span>;
  const total = mix.male + mix.female + mix.unisex;
  if (total === 0) return <span style={{ fontSize: 11, color: '#cbd5e1' }}>—</span>;
  const m = Math.round((mix.male   / total) * 100);
  const w = Math.round((mix.female / total) * 100);
  // unisex absorbs rounding drift so the three sum to 100 visually.
  const u = Math.max(0, 100 - m - w);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 80 }} title={`Men ${mix.male} · Women ${mix.female} · Unisex ${mix.unisex}`}>
      <div style={{ display: 'flex', height: 6, borderRadius: 999, overflow: 'hidden', background: '#f1f5f9' }}>
        {m > 0 && <div style={{ width: `${m}%`, background: '#2563eb' }} />}
        {w > 0 && <div style={{ width: `${w}%`, background: '#db2777' }} />}
        {u > 0 && <div style={{ width: `${u}%`, background: '#94a3b8' }} />}
      </div>
      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {m}/{w}/{u}
      </div>
    </div>
  );
}

// ── Table-level search ───────────────────────────────────────────────
// Minimal liquid-glass search bar. Filter chips (Rising/Falling/Empty/
// Zombie/Has issues) were removed in the minimal-catalog spec —
// everyone can search anything, that filter axis didn't earn its real
// estate. Counts on the right keep the "showing X of Y" affordance.
interface CatalogsTableSearchProps {
  query: string;
  onQuery: (q: string) => void;
  total: number;
  showing: number;
}

function CatalogsTableSearch({ query, onQuery, total, showing }: CatalogsTableSearchProps) {
  return (
    <div className="catalogs-table-search">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: 'rgba(15, 23, 42, 0.5)' }}>
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        type="text"
        placeholder="Search catalogs…"
        value={query}
        onChange={e => onQuery(e.target.value)}
        className="catalogs-table-search-input"
        aria-label="Search catalogs"
      />
      <span className="catalogs-table-search-count">
        {!query ? `${total} catalog${total === 1 ? '' : 's'}` : `${Math.max(0, showing)} of ${total}`}
      </span>
    </div>
  );
}

// ── Table-level search + quick filter (LEGACY) ───────────────────────
// Kept for the few non-catalog-list views that still want the chip
// filters; the main /admin/catalogs list now uses CatalogsTableSearch
// above.
interface CatalogsTableFilterBarProps {
  query: string;
  filter: 'all' | 'rising' | 'falling' | 'empty' | 'zombie' | 'issues';
  onQuery: (q: string) => void;
  onFilter: (f: 'all' | 'rising' | 'falling' | 'empty' | 'zombie' | 'issues') => void;
  total: number;
  showing: number;
}

function CatalogsTableFilterBar({ query, filter, onQuery, onFilter, total, showing }: CatalogsTableFilterBarProps) {
  const chips: { value: typeof filter; label: string; color?: string }[] = [
    { value: 'all',     label: 'All' },
    { value: 'rising',  label: '↑ Rising', color: '#047857' },
    { value: 'falling', label: '↓ Falling', color: '#b91c1c' },
    { value: 'empty',   label: '∅ Empty', color: '#a16207' },
    { value: 'zombie',  label: '⚠ Zombie', color: '#a16207' },
    { value: 'issues',  label: 'Has issues', color: '#b91c1c' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 0 12px' }}>
      <input
        type="text"
        placeholder="Search catalogs by name…"
        value={query}
        onChange={e => onQuery(e.target.value)}
        style={{
          flex: '0 1 260px',
          padding: '6px 10px',
          fontSize: 12,
          border: '1px solid #cbd5e1',
          borderRadius: 6,
          background: '#fff',
        }}
      />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {chips.map(c => {
          const active = filter === c.value;
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => onFilter(c.value)}
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                border: '1px solid',
                cursor: 'pointer',
                borderColor: active ? (c.color || '#111') : '#e2e8f0',
                background: active ? (c.color || '#111') : '#fff',
                color: active ? '#fff' : (c.color || '#475569'),
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>
      <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>
        {filter === 'all' && !query ? `${total} catalog${total === 1 ? '' : 's'}` : `${Math.max(0, showing)} of ${total}`}
      </span>
    </div>
  );
}

// ── Phase 7: catalog-system dashboard ─────────────────────────────────
// Page-level summary card above the catalogs table. Bird's-eye view of
// every metric we already aggregate so admins can answer "is the
// catalog system healthy?" without expanding a single row.
interface CatalogsDashboardProps {
  catalogs: Catalog[];
  impressionsByName: Map<string, { curr: number; prev: number }>;
  searchCountsByName: Map<string, CatalogSearchCounts>;
}

function CatalogsDashboard({ catalogs, impressionsByName, searchCountsByName }: CatalogsDashboardProps) {
  // Build derived figures from the maps we already have in scope.
  // No extra fetch — Phase 4's catalog_view_counts already powers the
  // impressions data; SearchCountPill data drives searches.
  const stats = useMemo(() => {
    let totalImp = 0, totalPrevImp = 0, totalSearches = 0, withImp = 0, withSearches = 0;
    let topMover: { name: string; pct: number } | null = null;
    let worstFaller: { name: string; pct: number } | null = null;
    let topByImp: { name: string; n: number } | null = null;
    let topBySearch: { name: string; n: number } | null = null;
    for (const c of catalogs) {
      const key = c.name.toLowerCase();
      const imp = impressionsByName.get(key);
      const sc = searchCountsByName.get(key);
      if (imp) {
        totalImp += imp.curr;
        totalPrevImp += imp.prev;
        if (imp.curr > 0) withImp++;
        if (!topByImp || imp.curr > topByImp.n) topByImp = { name: c.name, n: imp.curr };
        const pct = imp.prev > 0 ? ((imp.curr - imp.prev) / imp.prev) * 100 : null;
        if (pct !== null) {
          if (!topMover || pct > topMover.pct) topMover = { name: c.name, pct: Math.round(pct) };
          if (!worstFaller || pct < worstFaller.pct) worstFaller = { name: c.name, pct: Math.round(pct) };
        }
      }
      if (sc && sc.countTotal > 0) {
        totalSearches += sc.count7d;
        withSearches++;
        if (!topBySearch || sc.count7d > topBySearch.n) topBySearch = { name: c.name, n: sc.count7d };
      }
    }
    const trendPct = totalPrevImp > 0
      ? Math.round(((totalImp - totalPrevImp) / totalPrevImp) * 100)
      : null;
    const darkPct = catalogs.length > 0 ? Math.round((1 - withImp / catalogs.length) * 100) : 0;
    return { totalImp, totalPrevImp, trendPct, totalSearches, withImp, withSearches, topMover, worstFaller, topByImp, topBySearch, darkPct };
  }, [catalogs, impressionsByName, searchCountsByName]);

  const trendColor = stats.trendPct === null
    ? '#475569'
    : stats.trendPct >= 25 ? '#047857'
    : stats.trendPct <= -25 ? '#b91c1c'
    : '#475569';
  const trendLabel = stats.trendPct === null
    ? '—'
    : stats.trendPct === 0 ? '—'
    : `${stats.trendPct > 0 ? '↑' : '↓'}${Math.abs(stats.trendPct)}% vs prior 7d`;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: 1,
      background: '#e5e7eb',
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      overflow: 'hidden',
      marginBottom: 14,
    }}>
      <DashCell label="Impressions 7d" value={stats.totalImp.toLocaleString()} sub={trendLabel} accent={trendColor} />
      <DashCell label="Searches 7d" value={stats.totalSearches.toLocaleString()} sub={`across ${stats.withSearches} catalogs`} />
      <DashCell
        label="Top catalog · Impressions"
        value={stats.topByImp?.name ?? '—'}
        sub={stats.topByImp ? `${stats.topByImp.n.toLocaleString()} views` : 'no data'}
        accent="#0f172a"
      />
      <DashCell
        label="Top catalog · Searches"
        value={stats.topBySearch?.name ?? '—'}
        sub={stats.topBySearch ? `${stats.topBySearch.n.toLocaleString()} searches` : 'no data'}
        accent="#0f172a"
      />
      <DashCell
        label="Biggest riser"
        value={stats.topMover?.name ?? '—'}
        sub={stats.topMover ? `↑ ${stats.topMover.pct}% vs prior` : 'no data'}
        accent="#047857"
      />
      <DashCell
        label="Biggest faller"
        value={stats.worstFaller?.name ?? '—'}
        sub={stats.worstFaller ? `↓ ${Math.abs(stats.worstFaller.pct)}% vs prior` : 'no data'}
        accent="#b91c1c"
      />
      <DashCell
        label="Dark inventory"
        value={`${stats.darkPct}%`}
        sub={`${catalogs.length - stats.withImp} of ${catalogs.length} catalogs had 0 views`}
        accent={stats.darkPct > 50 ? '#b91c1c' : '#0f172a'}
      />
    </div>
  );
}

function DashCell({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{ background: '#fff', padding: '10px 12px', minWidth: 0 }}>
      <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: accent || '#0f172a', lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={value}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Search count pill ──────────────────────────────────────────────────────
function SearchCountPill({ counts }: { counts?: CatalogSearchCounts }) {
  if (!counts || counts.countTotal === 0) return <span style={{ fontSize: 11, color: '#ccc' }}>—</span>;
  const primary = counts.count24h > 0 ? counts.count24h : counts.count7d;
  const label = counts.count24h > 0 ? '24h' : '7d';
  return (
    <span
      title={`7d: ${counts.count7d.toLocaleString()} · All time: ${counts.countTotal.toLocaleString()}`}
      style={{
        padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
        background: '#f0f9ff', color: '#0369a1', cursor: 'default',
      }}
    >
      {primary.toLocaleString()}
      <span style={{ fontWeight: 400, marginLeft: 3, fontSize: 10, color: '#64748b' }}>{label}</span>
    </span>
  );
}

// ── 14-day mini sparkline (inline in the catalogs table) ──────────────────
// Hovering opens a richer popover with the day-by-day breakdown.
function MiniSparkline({ series }: { series?: number[] }) {
  const [hover, setHover] = useState(false);
  if (!series || series.length === 0 || series.every(n => n === 0)) {
    return <span style={{ fontSize: 11, color: '#cbd5e1' }}>—</span>;
  }
  const W = 64; const H = 18;
  const max = Math.max(1, ...series);
  const barW = W / series.length;
  const total = series.reduce((a, b) => a + b, 0);
  const days: string[] = [];
  const today = new Date();
  for (let i = series.length - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400_000);
    days.push(d.toISOString().slice(5, 10));
  }
  return (
    <span
      style={{ position: 'relative', display: 'inline-block', cursor: 'help' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img">
        <title>{`14-day impressions · total ${total} · peak ${max}`}</title>
        {series.map((v, i) => {
          const h = (v / max) * (H - 2);
          return (
            <rect
              key={i}
              x={i * barW + 0.5}
              y={H - h}
              width={Math.max(1, barW - 1)}
              height={h}
              fill="#2563eb"
              opacity={v === 0 ? 0.18 : 1}
              rx={1}
            />
          );
        })}
      </svg>
      {hover && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 30,
            width: 200,
            background: '#0f172a',
            color: '#fff',
            borderRadius: 6,
            padding: 8,
            pointerEvents: 'none',
            boxShadow: '0 10px 28px rgba(15,23,42,0.35)',
            textAlign: 'left',
          }}
        >
          <div style={{ fontSize: 10, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.4px', fontWeight: 700, marginBottom: 4 }}>
            Last 14 days
          </div>
          <div style={{ fontSize: 11, color: '#cbd5e1', display: 'flex', justifyContent: 'space-between' }}>
            <span>total</span><span style={{ fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{total}</span>
          </div>
          <div style={{ fontSize: 11, color: '#cbd5e1', display: 'flex', justifyContent: 'space-between' }}>
            <span>peak</span><span style={{ fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{max}</span>
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)', marginTop: 6, paddingTop: 6 }}>
            {series.map((v, i) => (
              <div key={i} style={{ fontSize: 10, color: '#cbd5e1', display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}>
                <span>{days[i]}</span>
                <span style={{ fontWeight: 600, color: v > 0 ? '#fff' : '#475569', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

// ── Impressions pill ──────────────────────────────────────────────────────
// Renders the 7-day catalog impression count + trend vs prior 7d.
// Driven by catalog_view_counts RPC; counts fire from the consumer
// ContinuousFeed when committedQuery commits to a catalog name.
function ImpressionsPill({ counts }: { counts?: { curr: number; prev: number } }) {
  if (!counts || counts.curr === 0) {
    return <span style={{ fontSize: 11, color: '#ccc' }}>—</span>;
  }
  const trendPct = counts.prev > 0
    ? Math.round(((counts.curr - counts.prev) / counts.prev) * 100)
    : null;
  const trendLabel = trendPct === null
    ? 'NEW'
    : trendPct === 0 ? '' : `${trendPct > 0 ? '↑' : '↓'}${Math.abs(trendPct)}%`;
  const trendColor = trendPct === null
    ? '#1d4ed8'
    : trendPct >= 25 ? '#047857'
    : trendPct <= -25 ? '#b91c1c'
    : '#64748b';
  return (
    <span
      title={`7d impressions: ${counts.curr.toLocaleString()} · Prior 7d: ${counts.prev.toLocaleString()}`}
      style={{
        padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
        background: '#ecfdf5', color: '#047857', cursor: 'default',
        display: 'inline-flex', alignItems: 'center', gap: 4,
      }}
    >
      {counts.curr.toLocaleString()}
      {trendLabel && (
        <span style={{ fontSize: 9, fontWeight: 700, color: trendColor, marginLeft: 1 }}>
          {trendLabel}
        </span>
      )}
    </span>
  );
}

// ── Toggle pills ────────────────────────────────────────────────────────────
type ToggleField = 'filterGender' | 'filterAge' | 'boostTopConverting';
interface TogglePillsProps {
  filterGender?: boolean;
  filterAge?: boolean;
  boostTopConverting?: boolean;
  onToggle: (field: ToggleField, value: boolean) => void;
}

function TogglePills({ filterGender, filterAge, boostTopConverting, onToggle }: TogglePillsProps) {
  const pills: { key: ToggleField; label: string; value: boolean; disabled?: boolean; title?: string }[] = [
    { key: 'filterGender',        label: 'Gender',  value: filterGender ?? false, title: 'Filter to viewer’s declared gender' },
    { key: 'filterAge',           label: 'Age',     value: filterAge ?? false, disabled: true },
    { key: 'boostTopConverting',  label: 'Top ↑', value: boostTopConverting ?? false, title: 'Boost top-converting products to the front' },
  ];
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      {pills.map(p => (
        <button
          key={p.key}
          onClick={() => !p.disabled && onToggle(p.key, !p.value)}
          disabled={p.disabled}
          title={
            p.disabled
              ? 'Run scripts/tag-product-age-groups.mjs first to enable age filtering'
              : `${p.title ?? p.label}: ${p.value ? 'ON — click to disable' : 'OFF — click to enable'}`
          }
          style={{
            padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
            border: '1px solid', cursor: p.disabled ? 'not-allowed' : 'pointer',
            borderColor: p.value ? '#111' : '#e2e8f0',
            background: p.value ? '#111' : p.disabled ? '#f8fafc' : '#fff',
            color: p.value ? '#fff' : p.disabled ? '#cbd5e1' : '#64748b',
            opacity: p.disabled ? 0.5 : 1,
            transition: 'all 0.1s',
          }}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

type ViewMode = 'grid' | 'list';
const VIEW_MODE_LS_KEY = 'catalog-admin:dropdown-view-mode';

// Phase 8: detail-drawer subject — what's open in the side panel,
// if anything. The drawer is rendered as a fixed-position overlay
// inside the dropdown component so it follows the catalog row's
// lifecycle (closes automatically when the dropdown collapses).
type DrawerSubject =
  | { kind: 'look'; look: CatalogLookRow }
  | { kind: 'product'; product: ProductRow }
  | { kind: 'creative'; creative: CatalogCreativeVideo }
  | null;

export function CatalogCreativeDropdown({ isAll, isUniverse, catalogName, loading, creative, metricsLoading, catalogNames, onReorder, onAfterBulkMutation, headerControls, onOpenAddLooks, onOpenAddProducts, onRecommendLooks, onRecommendProducts }: CatalogCreativeDropdownProps) {
  const [drawer, setDrawer] = useState<DrawerSubject>(null);
  // Re-render when the "View as" gender flips so the product list
  // refilters live. The MetricControlBar mutates the singleton; we
  // subscribe here purely to force a re-render of the dropdown body.
  const [, setShopperGenderRev] = useState(0);
  useEffect(() => {
    return subscribeToShopperGender(() => setShopperGenderRev(r => r + 1));
  }, []);
  // Phase 5: local sort/filter state. Per-dropdown so different
  // expanded catalogs can be sliced differently without interference.
  const [sort, setSort] = useState<MetricSort>('most-viewed');
  const [filter] = useState<MetricFilter>('all');
  // Per-catalog text search across looks (title/creator) and products
  // (name/brand). Lives inside the dropdown so each open catalog has
  // its own query.
  const [catalogSearch, setCatalogSearch] = useState('');
  // Phase 6: bulk selection. Two parallel sets so admins can pick
  // looks and products independently. Cleared on filter/sort/view
  // change to keep mental model sane.
  const [selectedLookIds, setSelectedLookIds] = useState<Set<string>>(new Set());
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  // Shift-click range anchor — last index clicked per section. Reset
  // whenever the underlying ordering changes.
  const lookAnchorRef = useRef<number | null>(null);
  const productAnchorRef = useRef<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  useEffect(() => {
    setSelectedLookIds(new Set());
    setSelectedProductIds(new Set());
    lookAnchorRef.current = null;
    productAnchorRef.current = null;
  }, [sort, filter]);
  // Grid vs spreadsheet-list view. Persisted to localStorage so an
  // admin who lives in list mode doesn't have to re-toggle every
  // session.
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    // List is the default view (spreadsheet-style) — honour a saved
    // preference if the admin explicitly switched to grid before.
    if (typeof window === 'undefined') return 'list';
    try { return (window.localStorage.getItem(VIEW_MODE_LS_KEY) as ViewMode) || 'list'; }
    catch { return 'list'; }
  });
  useEffect(() => {
    try { window.localStorage.setItem(VIEW_MODE_LS_KEY, viewMode); } catch { /* private mode */ }
  }, [viewMode]);

  // Super-admin "why this feed?" debug. Re-runs the feed-search pipeline in
  // diagnostics mode (which lane fired, hit counts, dedup) and surfaces it in
  // the shared SimilarDebugModal. Lazily computed on open only.
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const [feedDebug, setFeedDebug] = useState<{ open: boolean; loading: boolean; report: SimilarDebugReport | null }>(
    { open: false, loading: false, report: null },
  );
  const openFeedDebug = useCallback(async () => {
    setFeedDebug({ open: true, loading: true, report: null });
    try {
      const diag = await getFeedSearchDiagnostics(catalogName);
      setFeedDebug({ open: true, loading: false, report: buildFeedSearchReport(diag, catalogName) });
    } catch {
      setFeedDebug({ open: true, loading: false, report: null });
    }
  }, [catalogName]);

  // Unified FEED: which row types are shown, persisted so the admin's
  // choice survives reloads. Both on by default.
  const [showLooks, setShowLooks] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try { return window.localStorage.getItem('catalog-admin:feed-show-looks') !== '0'; } catch { return true; }
  });
  const [showProducts, setShowProducts] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try { return window.localStorage.getItem('catalog-admin:feed-show-products') !== '0'; } catch { return true; }
  });
  useEffect(() => { try { window.localStorage.setItem('catalog-admin:feed-show-looks', showLooks ? '1' : '0'); } catch { /* ignore */ } }, [showLooks]);
  useEffect(() => { try { window.localStorage.setItem('catalog-admin:feed-show-products', showProducts ? '1' : '0'); } catch { /* ignore */ } }, [showProducts]);
  // Interleaved feed drag-order (look:/product: keys).
  const [feedOrder, setFeedOrder] = useState<string[]>(() => loadFeedOrder());
  // Recommend Order: when set, the feed previews this proposed order
  // (not yet saved). Keep commits it to feedOrder; Discard clears it.
  const [previewOrder, setPreviewOrder] = useState<string[] | null>(null);

  // Persistence safety-net. The kept feed order lives in BOTH localStorage
  // (instant preview) and the DB (feed_rank — the source the live shopper
  // feed reads). This heavy admin page can evict its localStorage under
  // quota pressure, which made a "Keep this order" look like it didn't save
  // after a refresh. So whenever localStorage has no feed order, rebuild it
  // from the DB's unified feed_rank — the saved order always comes back, and
  // admin stays in lockstep with the consumer feed.
  useEffect(() => {
    if (feedOrder.length > 0 || !supabase) return;
    let cancelled = false;
    (async () => {
      const [looksRes, productsRes] = await Promise.all([
        supabase!.from('looks').select('id, feed_rank').not('feed_rank', 'is', null),
        supabase!.from('products').select('id, feed_rank').not('feed_rank', 'is', null),
      ]);
      if (cancelled) return;
      const keyed = [
        ...(((looksRes.data as { id: string; feed_rank: number }[] | null) || [])
          .map(r => ({ key: `look:${r.id}`, rank: r.feed_rank }))),
        ...(((productsRes.data as { id: string; feed_rank: number }[] | null) || [])
          .map(r => ({ key: `product:${r.id}`, rank: r.feed_rank }))),
      ].sort((a, b) => a.rank - b.rank);
      if (keyed.length > 0) setFeedOrder(keyed.map(k => k.key));
    })();
    return () => { cancelled = true; };
    // Mount-only: seed once from the DB when localStorage came up empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── ALL HOOKS MUST RUN BEFORE EARLY RETURNS (React Rule of Hooks) ──
  // Previously: 3 early returns BEFORE the 5 useCallbacks below,
  // producing React error #310 ("Rendered more hooks than during the
  // previous render") when `loading && !creative` flipped to false on
  // the second render. All useCallbacks now declared above any return.

  // Phase 6: selection toggle with shift-click range support. Generic
  // helper so looks and products share the same UX.
  const toggleSelection = useCallback(
    (kind: 'look' | 'product', id: string, index: number, items: { id: string }[], extendRange: boolean) => {
      const setSelected = kind === 'look' ? setSelectedLookIds : setSelectedProductIds;
      const anchorRef = kind === 'look' ? lookAnchorRef : productAnchorRef;
      if (extendRange && anchorRef.current !== null) {
        const from = Math.min(anchorRef.current, index);
        const to = Math.max(anchorRef.current, index);
        setSelected(prev => {
          const next = new Set(prev);
          for (let i = from; i <= to; i++) next.add(items[i].id);
          return next;
        });
      } else {
        setSelected(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
        });
        anchorRef.current = index;
      }
    },
    [],
  );

  const clearSelection = useCallback(() => {
    setSelectedLookIds(new Set());
    setSelectedProductIds(new Set());
  }, []);

  // Bulk handlers safely no-op when `creative` is missing — they only
  // run on user-click which happens after the dropdown is rendered
  // with data. Declared up here unconditionally to satisfy hook rules.
  const bulkRemoveFromCatalog = useCallback(async () => {
    if (!supabase || !creative) return;
    setBulkBusy(true);
    try {
      const lookOps = [...selectedLookIds].map(async id => {
        const look = creative.looks.find(l => l.id === id);
        if (!look) return;
        const { data: row } = await supabase!.from('looks').select('catalog_tags').eq('id', id).maybeSingle();
        const tags = ((row?.catalog_tags as string[] | null) || []).filter(t => t !== catalogName);
        await supabase!.from('looks').update({ catalog_tags: tags }).eq('id', id);
      });
      const productOps = [...selectedProductIds].map(async id => {
        const product = creative.products.find(p => p.id === id);
        if (!product) return;
        const { data: row } = await supabase!.from('products').select('catalog_tags').eq('id', id).maybeSingle();
        const tags = ((row?.catalog_tags as string[] | null) || []).filter(t => t !== catalogName);
        await supabase!.from('products').update({ catalog_tags: tags }).eq('id', id);
      });
      await Promise.all([...lookOps, ...productOps]);
      clearSelection();
      onAfterBulkMutation();
    } finally {
      setBulkBusy(false);
    }
  }, [selectedLookIds, selectedProductIds, creative, catalogName, clearSelection, onAfterBulkMutation]);

  const bulkHide = useCallback(async () => {
    if (!supabase) return;
    setBulkBusy(true);
    try {
      const lookIds = [...selectedLookIds];
      if (lookIds.length > 0) {
        await supabase.from('looks').update({ enabled: false }).in('id', lookIds);
      }
      clearSelection();
      onAfterBulkMutation();
    } finally {
      setBulkBusy(false);
    }
  }, [selectedLookIds, clearSelection, onAfterBulkMutation]);

  const bulkAddToCatalog = useCallback(async (targetName: string) => {
    if (!supabase || !targetName.trim() || targetName === catalogName) return;
    setBulkBusy(true);
    try {
      const lookOps = [...selectedLookIds].map(async id => {
        const { data: row } = await supabase!.from('looks').select('catalog_tags').eq('id', id).maybeSingle();
        const tags = new Set([...(row?.catalog_tags as string[] | null) || [], targetName]);
        await supabase!.from('looks').update({ catalog_tags: Array.from(tags) }).eq('id', id);
      });
      const productOps = [...selectedProductIds].map(async id => {
        const { data: row } = await supabase!.from('products').select('catalog_tags').eq('id', id).maybeSingle();
        const tags = new Set([...(row?.catalog_tags as string[] | null) || [], targetName]);
        await supabase!.from('products').update({ catalog_tags: Array.from(tags) }).eq('id', id);
      });
      await Promise.all([...lookOps, ...productOps]);
      clearSelection();
      onAfterBulkMutation();
    } finally {
      setBulkBusy(false);
    }
  }, [selectedLookIds, selectedProductIds, catalogName, clearSelection, onAfterBulkMutation]);

  // Per-row "remove from this catalog" (the minus button in the FEED list).
  // Named catalog → strip the catalog tag (inverse of bulkAddToCatalog).
  // Home/universe has no tag, so additionally unpublish looks
  // (enabled=false) — the same lever the consumer feed already respects —
  // so removing a look from Home actually takes it off the live feed.
  const removeFromCatalog = useCallback(async (row: FeedRow) => {
    if (!supabase) return;
    setBulkBusy(true);
    try {
      const table = row.kind === 'look' ? 'looks' : 'products';
      const { data } = await supabase.from(table).select('catalog_tags').eq('id', row.id).maybeSingle();
      const tags = ((data?.catalog_tags as string[] | null) || []).filter(t => t !== catalogName);
      const patch: Record<string, unknown> = { catalog_tags: tags };
      // Home/universe has no tag to strip, so removal = take it off the
      // live feed. Looks: enabled=false. Products: is_active=false — the
      // consumer feed's useHiddenProductKeys already filters those out.
      if (isUniverse || isAll) {
        if (row.kind === 'look') patch.enabled = false;
        else patch.is_active = false;
      }
      await supabase.from(table).update(patch).eq('id', row.id);
      onAfterBulkMutation();
    } finally {
      setBulkBusy(false);
    }
  }, [catalogName, isUniverse, isAll, onAfterBulkMutation]);

  // Row controls (toggles + add/suggest/assemble) relocated from the
  // table columns into this detail header. Rendered in every state —
  // including empty — since that's exactly when "Add products" matters.
  const controlsBar = headerControls ? (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
      padding: '0 0 12px', marginBottom: 2, borderBottom: '1px solid #eef2f7',
    }}>
      {headerControls}
    </div>
  ) : null;

  // Context modal open state. Hoisted above the early returns below
  // so the hook count stays stable across the loading → loaded
  // transition (React error #310: a previous version declared this
  // useState BELOW `if (!creative) return ...`, so the hook fired
  // only on the second render and React saw two different hook
  // counts on consecutive renders).
  const [contextOpen, setContextOpen] = useState(false);

  // ── Early returns (now AFTER all hooks) ─────────────────────────────
  if (loading && !creative) {
    return (
      <div style={{ padding: '14px 24px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {controlsBar}
        <div style={{ color: '#888', fontSize: 12 }}>Loading creative…</div>
      </div>
    );
  }
  if (!creative) {
    return controlsBar ? <div style={{ padding: '14px 24px 18px' }}>{controlsBar}</div> : null;
  }

  const { looks, products, creatives, feedResults } = creative;
  const hasAny = looks.length > 0 || products.length > 0 || creatives.length > 0 || (feedResults?.length ?? 0) > 0;
  if (!hasAny) {
    return (
      <div style={{ padding: '14px 24px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {controlsBar}
        <div style={{ color: '#888', fontSize: 12 }}>
          No looks, products, or creative {isUniverse ? 'are currently active.' : 'tagged with this catalog yet.'}
        </div>
      </div>
    );
  }

  // "View as" — when the admin picks Men or Women in the control bar
  // the global shopperGender flips. Mirror the consumer feed's
  // visibility rule here so the preview matches what a real shopper
  // of that gender would actually see (own gender + unisex; untagged
  // hidden so the admin can spot rows that need a gender backfill).
  // Applied to BOTH looks and products — without this, "View as: Men"
  // emptied the Looks section even though men's looks existed.
  const viewAsGender = getShopperGender();
  // looks + products store gender as `women` / `men` / `unisex`, but
  // the shopperGender singleton uses `male` / `female` / `unknown`.
  // Normalize both sides to a shared {male|female|unisex} vocabulary so
  // "View as: Men" actually surfaces the men's looks instead of zero.
  const normalize = (g: string | null | undefined): 'male' | 'female' | 'unisex' | null => {
    const x = (g || '').toLowerCase().trim();
    if (!x) return null;
    if (x === 'male' || x === 'men' || x === 'man' || x === 'm') return 'male';
    if (x === 'female' || x === 'women' || x === 'woman' || x === 'w') return 'female';
    if (x === 'unisex' || x === 'all' || x === 'u') return 'unisex';
    return null;
  };
  const genderMatches = (g: string | null | undefined): boolean => {
    if (viewAsGender === 'unknown') return true;
    const x = normalize(g);
    if (!x) return false;
    if (x === 'unisex') return true;
    return x === viewAsGender;
  };
  const visibleLooks    = viewAsGender === 'unknown' ? looks    : looks.filter(l => genderMatches(l.gender));
  const visibleProducts = viewAsGender === 'unknown' ? products : products.filter(p => genderMatches(p.gender));
  // Per-catalog text search applied before sort/filter — matches against
  // look title/creator and product name/brand. Whitespace-tolerant
  // substring match, case-insensitive.
  const q = catalogSearch.trim().toLowerCase();
  const searchedLooks = q
    ? visibleLooks.filter(l => {
        const hay = `${l.title ?? ''} ${l.creatorName ?? ''} ${l.creatorHandle ?? ''}`.toLowerCase();
        return hay.includes(q);
      })
    : visibleLooks;
  const searchedProducts = q
    ? visibleProducts.filter(p => {
        const hay = `${p.name ?? ''} ${p.brand ?? ''}`.toLowerCase();
        return hay.includes(q);
      })
    : visibleProducts;
  const sortedLooks    = sortAndFilterItems(searchedLooks, sort, filter);
  const sortedProducts = sortAndFilterItems(searchedProducts, sort, filter);

  // ── Unified FEED ──────────────────────────────────────────────────
  // Merge looks + products into one interleaved, metric-sorted list,
  // gated by the show-looks / show-products toggles, then apply any
  // saved drag order on top. feedRows powers the list-view FEED table.
  //
  // NOTE: a previous version wrapped this in useMemo + handleFeedReorder
  // in useCallback. That placed two hooks BELOW the `if (!creative)`
  // early returns earlier in the function, which violates the Rules of
  // Hooks (the hook count differs between the loading and ready renders)
  // and crashed /admin/catalogs in production with React error #310.
  // The work here is cheap iteration over a small list; plain expressions
  // are correct and faster than the broken-hook variant.
  const feedRows: FeedRow[] = (() => {
    const base: FeedRow[] = [];
    if (showLooks) {
      for (const l of sortedLooks) base.push({ kind: 'look', id: l.id, key: `look:${l.id}`, metrics: l.metrics, createdAt: l.createdAt ?? null, look: l });
    }
    if (showProducts) {
      for (const p of sortedProducts) base.push({ kind: 'product', id: p.id, key: `product:${p.id}`, metrics: p.metrics, createdAt: (p as { createdAt?: string | null }).createdAt ?? null, product: p });
    }
    const merged = sortAndFilterItems(base, sort, filter);
    // A previewed Recommend Order wins over the saved order until kept.
    const activeOrder = previewOrder ?? feedOrder;
    if (activeOrder.length === 0) return merged;
    const orderIdx = new Map(activeOrder.map((k, i) => [k, i]));
    return [...merged].sort((a, b) => {
      const ai = orderIdx.has(a.key) ? orderIdx.get(a.key)! : Number.MAX_SAFE_INTEGER;
      const bi = orderIdx.has(b.key) ? orderIdx.get(b.key)! : Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  })();

  // Recommend Order handlers.
  const runRecommendOrder = () => {
    setPreviewOrder(recommendFeedOrder(sortedLooks, sortedProducts));
  };
  const keepRecommendedOrder = () => {
    if (!previewOrder) return;
    setFeedOrder(previewOrder);
    saveFeedOrder(previewOrder);
    // Persist to the DB so the CONSUMER feed honours this order too.
    // apply_feed_order now takes the FULL unified key sequence and writes
    // feed_rank = unified position across BOTH looks and products, so the
    // home feed (getHomeFeed sorts the combined list by feed_rank)
    // reproduces this exact interleaved order.
    if (supabase) {
      supabase.rpc('apply_feed_order', { ordered_keys: previewOrder })
        .then(({ error }) => {
          if (error) console.warn('[catalog] apply_feed_order failed:', error.message);
        });
    }
    setPreviewOrder(null);
  };
  const discardRecommendedOrder = () => setPreviewOrder(null);

  // Context modal: surfaces the algorithmic reasoning behind the
  // current feed order so admins don't have to read the source to
  // understand why a tile is at position N. Lives next to the
  // Recommend Order button — tap to see the per-row score
  // breakdown (exploit + explore + interleave rule + sort/filter).
  // contextOpen state lives at the top of the component (above the
  // early returns) — see the React-error-310 comment up there.
  // contextRows used to be a useMemo but moved to a plain const so
  // it can sit AFTER the early returns without violating the
  // rules-of-hooks; the memo was a tiny optimization, not
  // load-bearing.
  const contextRows = (() => {
    // Mirror recommendFeedOrder's math so the modal shows the SAME
    // numbers that drive ordering — single source of truth.
    const items = [
      ...sortedLooks.map(l => ({ kind: 'look' as const, id: l.id, key: `look:${l.id}`, title: (l as { title?: string }).title || '', m: l.metrics })),
      ...sortedProducts.map(p => ({ kind: 'product' as const, id: p.id, key: `product:${p.id}`, title: (p as { name?: string; title?: string }).name || (p as { title?: string }).title || '', m: p.metrics })),
    ];
    if (items.length === 0) return [];
    const totalImp = items.reduce((s, x) => s + (x.m?.impressions ?? 0), 0) + 1;
    const enriched = items.map(x => {
      const imp = x.m?.impressions ?? 0;
      const clk = x.m?.clickouts ?? 0;
      const ctr = x.m?.ctr ?? 0;
      const exploit = 0.7 * (imp > 0 ? clk / imp : 0) + 0.3 * ctr;
      const explore = Math.sqrt(Math.log(totalImp + 1) / (imp + 1));
      return { ...x, imp, clk, ctr, exploit, explore };
    });
    const norm = (vals: number[]) => {
      let mn = Infinity, mx = -Infinity;
      for (const v of vals) { if (v < mn) mn = v; if (v > mx) mx = v; }
      const range = mx - mn || 1;
      return (v: number) => (v - mn) / range;
    };
    const eN = norm(enriched.map(e => e.exploit));
    const xN = norm(enriched.map(e => e.explore));
    const EXPLORE_W = 0.6;
    return enriched
      .map(e => ({ ...e, score: eN(e.exploit) + EXPLORE_W * xN(e.explore) }))
      .sort((a, b) => b.score - a.score);
  })();

  const handleFeedReorder = (from: number, to: number) => {
    if (from === to) return;
    const keys = feedRows.map(r => r.key);
    const [moved] = keys.splice(from, 1);
    keys.splice(to, 0, moved);
    setFeedOrder(keys);
    saveFeedOrder(keys);
    // Persist the unified order to the DB so the consumer home feed matches
    // a manual drag-reorder, not just "Recommend Order → Keep".
    if (supabase) {
      supabase.rpc('apply_feed_order', { ordered_keys: keys })
        .then(({ error }) => {
          if (error) console.warn('[catalog] apply_feed_order (manual) failed:', error.message);
        });
    }
  };

  // Phase 7-lite: KPI strip.
  const kpi = buildKpiStrip([...sortedLooks, ...sortedProducts]);

  const selectionCount = selectedLookIds.size + selectedProductIds.size;

  return (
    <div style={{ padding: '14px 24px 18px', display: 'flex', flexDirection: 'column', gap: 14, position: 'relative' }}>
      {controlsBar}
      {isAll && (
        <div style={{ fontSize: 11, color: '#475569', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 10px' }}>
          The <strong>all</strong> catalog pulls every live look, rendered creative, and product - no duplicates, every entry shown in its entirety. Drag any tile to reorder.
        </div>
      )}
      {!isAll && isUniverse && (
        <div style={{ fontSize: 11, color: '#475569', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, padding: '6px 10px' }}>
          The <strong>home</strong> catalog is the <strong>candidate pool + baseline order</strong> —
          what a brand-new shopper sees, and the starting point every shopper's <strong>Daily Feed</strong>
          re-ranks from (Daily Feed engine + feed rules). No two shoppers see this exact
          order: curate the pool and baseline here, tune the rules in <strong>Daily Feed</strong>,
          and use <strong>Preview feed</strong> to see the result as any specific user.
        </div>
      )}

      <KpiStrip kpi={kpi} metricsLoading={metricsLoading} />

      {/* Search + Sort + View as + Grid/List on one row. The search
          input flexes to fill remaining width; the MetricControlBar
          renders the sort dropdown, view-as dropdown, and grid/list
          toggle (it already lays itself out as a flex row). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 200, maxWidth: 420 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            value={catalogSearch}
            onChange={e => setCatalogSearch(e.target.value)}
            placeholder="Search this catalog — products + looks…"
            style={{
              width: '100%', padding: '7px 28px 7px 30px', borderRadius: 8,
              border: '1px solid #e2e8f0', fontSize: 12, background: '#fff',
              boxSizing: 'border-box',
            }}
          />
          {catalogSearch && (
            <button type="button" onClick={() => setCatalogSearch('')}
              aria-label="Clear search"
              style={{
                position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                width: 18, height: 18, borderRadius: 999, border: 'none',
                background: '#e2e8f0', color: '#475569', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, fontSize: 11,
              }}
            >×</button>
          )}
        </div>
        <MetricControlBar
          sort={sort} viewMode={viewMode}
          onSort={setSort} onViewMode={setViewMode}
        />
        {isSuperAdmin && !isAll && (
          <button
            type="button"
            onClick={openFeedDebug}
            title="Why these feed results? (super-admin debug)"
            aria-label="Why these feed results? (super-admin debug)"
            style={{
              fontSize: 11, fontWeight: 700, padding: '4px 11px', borderRadius: 999,
              border: '1px solid #34d399', background: '#ecfdf5', color: '#047857',
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            ⓘ why feed
          </button>
        )}
      </div>

      {viewMode === 'list' ? (
        <div>
          {/* Unified FEED header: count + show-toggles + add/recommend. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
            <h4 style={{ margin: 0, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#475569', fontWeight: 700 }}>Feed</h4>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>{feedRows.length}</span>
            {/* Show looks / products toggles */}
            <div style={{ display: 'inline-flex', gap: 6, marginLeft: 6 }}>
              <button
                type="button"
                onClick={() => setShowLooks(v => !v)}
                className={`admin-btn ${showLooks ? 'admin-btn-primary' : 'admin-btn-secondary'}`}
                style={{ fontSize: 11, padding: '3px 10px', opacity: showLooks ? 1 : 0.6 }}
                title="Show or hide looks in the feed"
              >
                {showLooks ? '✓ ' : ''}Looks ({sortedLooks.length})
              </button>
              <button
                type="button"
                onClick={() => setShowProducts(v => !v)}
                className={`admin-btn ${showProducts ? 'admin-btn-primary' : 'admin-btn-secondary'}`}
                style={{ fontSize: 11, padding: '3px 10px', opacity: showProducts ? 1 : 0.6 }}
                title="Show or hide products in the feed"
              >
                {showProducts ? '✓ ' : ''}Products ({sortedProducts.length})
              </button>
            </div>
            <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
              {onOpenAddLooks && <button type="button" onClick={onOpenAddLooks} className="admin-btn admin-btn-secondary" style={{ fontSize: 11, padding: '3px 10px' }}>+ Add Looks</button>}
              {onOpenAddProducts && <button type="button" onClick={onOpenAddProducts} className="admin-btn admin-btn-secondary" style={{ fontSize: 11, padding: '3px 10px' }}>+ Add Products</button>}
              <button type="button" onClick={runRecommendOrder} className="admin-btn admin-btn-primary" style={{ fontSize: 11, padding: '3px 10px' }} title="Re-rank the feed: proven converters + under-tested items up top, ~2 looks : 1 product">✨ Recommend Order</button>
              {/* Context button: opens a modal that explains the exact
                  scores driving the current feed order. Mirrors the
                  recommendFeedOrder math so admins can see why item N
                  is at position N without reading source. */}
              <button
                type="button"
                onClick={() => setContextOpen(true)}
                className="admin-btn admin-btn-secondary"
                style={{ fontSize: 11, padding: '3px 10px' }}
                title="Show how this feed was scored — exploit + explore + interleave rule"
              >
                ⓘ Context
              </button>
              {onRecommendLooks && <button type="button" onClick={onRecommendLooks} className="admin-btn admin-btn-secondary" style={{ fontSize: 11, padding: '3px 10px' }}>✨ Recommend Looks</button>}
              {onRecommendProducts && <button type="button" onClick={onRecommendProducts} className="admin-btn admin-btn-secondary" style={{ fontSize: 11, padding: '3px 10px' }}>✨ Recommend Products</button>}
            </div>
          </div>

          {/* Recommend Order preview bar — appears once a recommendation
              is computed; the feed below previews it until kept/discarded. */}
          {previewOrder && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              margin: '8px 0 0', padding: '10px 14px', borderRadius: 10,
              border: '1px solid #c7d2fe', background: '#eef2ff',
            }}>
              <span style={{ fontSize: 12, color: '#3730a3' }}>
                <strong>Recommended order previewed</strong> — winners + under-tested items up top, ~2 looks : 1 product. Keep to publish this order to the live shopper feed.
              </span>
              <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
                <button type="button" onClick={discardRecommendedOrder} className="admin-btn admin-btn-secondary" style={{ fontSize: 11, padding: '4px 12px' }}>Discard</button>
                <button type="button" onClick={keepRecommendedOrder} className="admin-btn admin-btn-primary" style={{ fontSize: 11, padding: '4px 12px' }}>Keep this order</button>
              </div>
            </div>
          )}

          {feedRows.length === 0 ? (
            <div style={{ padding: '12px 14px', color: '#888', fontSize: 12, border: '1px dashed #e5e7eb', borderRadius: 8, marginTop: 6 }}>
              {(!showLooks && !showProducts) ? 'Both looks and products are hidden — toggle one on above.' : 'Nothing matches the current filter.'}
            </div>
          ) : (
            <FeedListTable
              rows={feedRows}
              selectedLookIds={selectedLookIds}
              selectedProductIds={selectedProductIds}
              onSelectLook={(id, idx, ext) => toggleSelection('look', id, idx, sortedLooks, ext)}
              onSelectProduct={(id, idx, ext) => toggleSelection('product', id, idx, sortedProducts, ext)}
              onRemove={removeFromCatalog}
              onSelectAll={(next) => {
                setSelectedLookIds(prev => {
                  const out = new Set(prev);
                  for (const r of feedRows) if (r.kind === 'look') { if (next) out.add(r.id); else out.delete(r.id); }
                  return out;
                });
                setSelectedProductIds(prev => {
                  const out = new Set(prev);
                  for (const r of feedRows) if (r.kind === 'product') { if (next) out.add(r.id); else out.delete(r.id); }
                  return out;
                });
              }}
              // Interleaved reorder persists across types; same gating as
              // the per-section reorder (universe view, default sort/filter,
              // no active selection).
              draggable={(isAll || isUniverse) && filter === 'all' && sort === 'most-viewed' && selectionCount === 0}
              onReorder={handleFeedReorder}
              onOpenDetail={(row) => setDrawer(row.kind === 'look' ? { kind: 'look', look: row.look } : { kind: 'product', product: row.product })}
            />
          )}
        </div>
      ) : (
        <>
          {showLooks && (
          <DraggableSection
            title="Looks"
            count={sortedLooks.length}
            emptyMessage="No looks match the current filter."
            minColumnPx={140}
            draggable={isAll && filter === 'all' && sort === 'most-viewed' && selectionCount === 0}
            onReorder={(from, to) => onReorder('looks', from, to)}
            onAdd={onOpenAddLooks}
            addLabel="+ Add Looks"
            onRecommend={onRecommendLooks}
            recommendLabel="Recommend Looks"
          >
            {sortedLooks.map((l, idx) => (
              <LookThumb
                key={l.id}
                look={l}
                selected={selectedLookIds.has(l.id)}
                onSelect={(ext) => toggleSelection('look', l.id, idx, sortedLooks, ext)}
                onOpenDetail={() => setDrawer({ kind: 'look', look: l })}
              />
            ))}
          </DraggableSection>
          )}

          {showProducts && (
          <DraggableSection
            title="Products"
            count={sortedProducts.length}
            emptyMessage="No products match the current filter."
            minColumnPx={140}
            draggable={(isAll || isUniverse) && filter === 'all' && sort === 'most-viewed' && selectionCount === 0}
            onReorder={(from, to) => onReorder('products', from, to)}
            onAdd={onOpenAddProducts}
            addLabel="+ Add Products"
            onRecommend={onRecommendProducts}
            recommendLabel="Recommend Products"
          >
            {sortedProducts.map((p, idx) => (
              <ProductMetricTile
                key={p.id}
                product={p}
                selected={selectedProductIds.has(p.id)}
                onSelect={(ext) => toggleSelection('product', p.id, idx, sortedProducts, ext)}
                onOpenDetail={() => setDrawer({ kind: 'product', product: p })}
              />
            ))}
          </DraggableSection>
          )}
        </>
      )}

      {selectionCount > 0 && (
        <BulkActionBar
          count={selectionCount}
          catalogName={catalogName}
          catalogNames={catalogNames}
          busy={bulkBusy}
          onClear={clearSelection}
          onRemove={bulkRemoveFromCatalog}
          onHide={bulkHide}
          onAddTo={bulkAddToCatalog}
          looksCount={selectedLookIds.size}
          productsCount={selectedProductIds.size}
        />
      )}

      {drawer && (
        <DetailDrawer subject={drawer} catalogName={catalogName} onClose={() => setDrawer(null)} />
      )}

      {/* Context modal — explains the algorithmic reasoning behind the
          current feed order. Click any of the buttons next to Recommend
          Order to open. Pure read-only: the same numbers drive the
          live order, so what the modal shows IS what the feed sees. */}
      {contextOpen && (
        <div className="admin-modal-overlay" onClick={() => setContextOpen(false)}>
          <div
            className="admin-modal"
            style={{ width: 820, maxWidth: '94vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '18px 22px 12px', borderBottom: '1px solid #f0f0f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
                  Feed context for &ldquo;{catalogName}&rdquo;
                </h2>
                <button
                  type="button"
                  onClick={() => setContextOpen(false)}
                  className="admin-btn admin-btn-secondary"
                  style={{ fontSize: 11, padding: '4px 10px' }}
                >Close</button>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
                The feed is sorted by a blended <strong>exploit + explore</strong> score, then
                interleaved <strong>2 looks : 1 product</strong>. Sort / filter / search are applied
                FIRST so the candidate set matches the table above. Sort: <strong>{sort}</strong>,
                Filter: <strong>{filter}</strong>{catalogSearch ? <>, Query: &ldquo;<strong>{catalogSearch}</strong>&rdquo;</> : null}.
              </p>
              <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 11, color: '#475569', flexWrap: 'wrap' }}>
                <span><strong>Exploit</strong> = 0.7 × clickout rate + 0.3 × CTR</span>
                <span><strong>Explore</strong> = √(ln(totalImp+1) / (imp+1)) &nbsp;<em>(UCB1)</em></span>
                <span><strong>Score</strong> = normalised exploit + 0.6 × normalised explore</span>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
              {contextRows.length === 0 ? (
                <div style={{ padding: '32px 24px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                  Nothing in this catalog yet — add a look or product to see the scoring.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#fafafa' }}>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ textAlign: 'left',  padding: '8px 14px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase' }}>#</th>
                      <th style={{ textAlign: 'left',  padding: '8px 14px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Kind</th>
                      <th style={{ textAlign: 'left',  padding: '8px 14px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Title</th>
                      <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Imp</th>
                      <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Clk</th>
                      <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase' }}>CTR</th>
                      <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Exploit</th>
                      <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Explore</th>
                      <th style={{ textAlign: 'right', padding: '8px 14px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contextRows.map((r, i) => (
                      <tr key={r.key} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 14px', color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</td>
                        <td style={{ padding: '8px 14px' }}>
                          <span style={{
                            display: 'inline-block', padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 600,
                            background: r.kind === 'look' ? '#f0fdf4' : '#eff6ff',
                            color: r.kind === 'look' ? '#15803d' : '#1d4ed8',
                          }}>{r.kind}</span>
                        </td>
                        <td style={{ padding: '8px 14px', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#111' }} title={r.title}>
                          {r.title || <span style={{ color: '#cbd5e1' }}>—</span>}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#475569', fontVariantNumeric: 'tabular-nums' }}>{r.imp}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#475569', fontVariantNumeric: 'tabular-nums' }}>{r.clk}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#475569', fontVariantNumeric: 'tabular-nums' }}>{(r.ctr * 100).toFixed(1)}%</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#475569', fontVariantNumeric: 'tabular-nums' }}>{r.exploit.toFixed(3)}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#475569', fontVariantNumeric: 'tabular-nums' }}>{r.explore.toFixed(3)}</td>
                        <td style={{ padding: '8px 14px', textAlign: 'right', color: '#0f172a', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{r.score.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {feedDebug.open && (
        <SimilarDebugModal
          report={feedDebug.report}
          loading={feedDebug.loading}
          onClose={() => setFeedDebug({ open: false, loading: false, report: null })}
        />
      )}
    </div>
  );
}

// ── Phase 8: detail drawer ──────────────────────────────────────────
// Side panel that slides in from the right when an admin clicks the
// expand icon on a look or product tile. No new RPCs — everything
// it shows is already on the row (video, image, metrics, attached
// products / brand) or in the catalog tags array.

function DetailDrawer({ subject, catalogName, onClose }: { subject: NonNullable<DrawerSubject>; catalogName: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(15,23,42,0.45)',
          zIndex: 90,
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 'min(440px, 92vw)',
          background: '#fff',
          boxShadow: '-16px 0 48px rgba(15,23,42,0.25)',
          zIndex: 100,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #e5e7eb' }}>
          <div>
            <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>
              {subject.kind === 'look' ? 'Look' : subject.kind === 'product' ? 'Product' : 'Creative'} · {catalogName}
            </div>
            <h2 style={{ margin: '2px 0 0', fontSize: 16, color: '#0f172a' }}>
              {subject.kind === 'look'
                ? (subject.look.title || `Look #${subject.look.legacyId ?? ''}`)
                : subject.kind === 'product'
                ? (subject.product.name || 'Unnamed product')
                : (subject.creative.productName || subject.creative.title || 'Creative')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, color: '#475569' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </header>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {subject.kind === 'look'
            ? <LookDetailBody look={subject.look} />
            : subject.kind === 'product'
            ? <ProductDetailBody product={subject.product} />
            : <CreativeDetailBody creative={subject.creative} />}
        </div>
      </aside>
    </>
  );
}

function MetricMiniCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{ flex: '1 1 0', minWidth: 0, padding: '8px 10px', background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 6 }}>
      <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: accent || '#0f172a' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#64748b', marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

// Daily metrics hook for the detail drawer sparkline. Loads on first
// mount + on subject change; null while loading or if the RPC errors
// so the sparkline can render an "awaiting data" placeholder.
function useDailyMetrics(targetType: 'look' | 'product', primaryKey: string, fallbackKey?: string | number | null) {
  const [data, setData] = useState<{ day: string; impressions: number; clicks: number; clickouts: number }[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let cancelled = false;
    const keys = [primaryKey, fallbackKey].filter((k): k is string | number => k !== null && k !== undefined);
    (async () => {
      setLoading(true);
      for (const k of keys) {
        const { data: rows, error } = await supabase!.rpc('catalog_item_daily_metrics', {
          p_target_type: targetType,
          p_target_key: String(k),
          p_days: 14,
        });
        if (cancelled) return;
        if (error) continue;
        if (rows && (rows as unknown[]).length > 0) {
          const typed = (rows as { day: string; impressions: number | string; clicks: number | string; clickouts: number | string }[]).map(r => ({
            day: r.day,
            impressions: Number(r.impressions) || 0,
            clicks: Number(r.clicks) || 0,
            clickouts: Number(r.clickouts) || 0,
          }));
          // Only commit if there's any signal — otherwise keep
          // checking the fallback key (legacy_id).
          if (typed.some(d => d.impressions > 0 || d.clicks > 0)) {
            setData(typed);
            setLoading(false);
            return;
          }
          setData(typed);
        }
      }
      setLoading(false);
    })().catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [targetType, primaryKey, fallbackKey]);
  return { data, loading };
}

// 14-day impressions sparkline. Inline SVG so we don't pull a charting
// dep. Bars scale to the max value; faint baseline grid every 25%.
function DailySparkline({ data, accent = '#2563eb' }: { data: { day: string; impressions: number }[] | null; accent?: string }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ fontSize: 11, color: '#94a3b8', padding: '12px 0', textAlign: 'center' }}>
        No daily activity in the last 14 days.
      </div>
    );
  }
  const max = Math.max(1, ...data.map(d => d.impressions));
  const W = 380; const H = 80;
  const barW = W / data.length;
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        <line x1={0} y1={H * 0.5} x2={W} y2={H * 0.5} stroke="#f1f5f9" strokeWidth={1} />
        <line x1={0} y1={H * 0.25} x2={W} y2={H * 0.25} stroke="#f8fafc" strokeWidth={1} />
        <line x1={0} y1={H * 0.75} x2={W} y2={H * 0.75} stroke="#f8fafc" strokeWidth={1} />
        {data.map((d, i) => {
          const h = max > 0 ? (d.impressions / max) * (H - 6) : 0;
          return (
            <g key={d.day}>
              <rect
                x={i * barW + 1}
                y={H - h}
                width={Math.max(1, barW - 2)}
                height={h}
                fill={accent}
                rx={1.5}
                opacity={d.impressions === 0 ? 0.2 : 1}
              >
                <title>{`${d.day}: ${d.impressions} impression${d.impressions === 1 ? '' : 's'}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
        <span style={{ fontSize: 9, color: '#94a3b8' }}>{data[0]?.day}</span>
        <span style={{ fontSize: 9, color: '#94a3b8' }}>peak {max}</span>
        <span style={{ fontSize: 9, color: '#94a3b8' }}>{data[data.length - 1]?.day}</span>
      </div>
    </div>
  );
}

function LookDetailBody({ look }: { look: CatalogLookRow }) {
  const src = look.videoPath
    ? (look.videoPath.startsWith('http') ? look.videoPath : `${import.meta.env.BASE_URL}${look.videoPath.replace(/^\//, '')}`)
    : null;
  const m = look.metrics;
  const trendLabel = m?.trendPct === null || m?.trendPct === undefined
    ? '—'
    : m.trendPct === 0 ? '—' : `${m.trendPct > 0 ? '↑' : '↓'}${Math.abs(m.trendPct)}%`;
  const trendColor = (m?.trendPct ?? 0) >= 25 ? '#047857'
    : (m?.trendPct ?? 0) <= -25 ? '#b91c1c'
    : '#475569';
  const { data: daily } = useDailyMetrics('look', look.id, look.legacyId);
  return (
    <>
      <div style={{ aspectRatio: '9/16', borderRadius: 8, overflow: 'hidden', background: '#000', maxHeight: 360 }}>
        {src ? (
          <video src={src} muted loop playsInline autoPlay style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b', fontSize: 12 }}>No video</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {look.creatorAvatarUrl ? (
          <img src={look.creatorAvatarUrl} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#e2e8f0' }} />
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{look.creatorName || look.creatorHandle || 'Unknown'}</div>
          {look.creatorHandle && (
            <div style={{ fontSize: 11, color: '#64748b' }}>@{look.creatorHandle}</div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <MetricMiniCard label="Impressions 7d" value={(m?.impressions ?? 0).toLocaleString()} sub={m ? `was ${m.impressionsPrev.toLocaleString()}` : undefined} />
        <MetricMiniCard label="CTR" value={m && m.impressions > 0 ? `${(m.ctr * 100).toFixed(1)}%` : '—'} />
        <MetricMiniCard label="Clickouts" value={(m?.clickouts ?? 0).toLocaleString()} />
        <MetricMiniCard label="Trend" value={trendLabel} accent={trendColor} />
      </div>

      <div>
        <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700, marginBottom: 4 }}>
          Last 14 days
        </div>
        <DailySparkline data={daily} />
      </div>

      <div>
        <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700, marginBottom: 4 }}>
          Attached products
        </div>
        <div style={{ fontSize: 13, color: '#475569' }}>
          {look.productCount} product{look.productCount === 1 ? '' : 's'} tagged on this look.
        </div>
      </div>

      {look.createdAt && (
        <div style={{ fontSize: 11, color: '#94a3b8' }}>
          Created {new Date(look.createdAt).toLocaleDateString()}
        </div>
      )}
    </>
  );
}

function CreativeDetailBody({ creative }: { creative: CatalogCreativeVideo }) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  return (
    <>
      <div style={{ aspectRatio: '9/16', borderRadius: 8, overflow: 'hidden', background: '#000', maxHeight: 360 }}>
        <video
          ref={videoRef}
          src={creative.videoUrl}
          poster={creative.thumbnailUrl ?? undefined}
          muted loop playsInline autoPlay
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>

      <div>
        <div style={{ fontSize: 11, color: '#64748b' }}>{creative.productBrand || '—'}</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>
          {creative.productName || creative.title || 'Creative'}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{
          padding: '2px 8px', borderRadius: 4,
          fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px',
          background: creative.status === 'live' ? '#10b981' : '#e5e7eb',
          color: creative.status === 'live' ? '#fff' : '#475569',
        }}>
          {creative.status}
        </span>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>
          product_creative.id · {creative.id.slice(0, 8)}…
        </span>
      </div>

      {creative.productImageUrl && (
        <div>
          <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700, marginBottom: 4 }}>
            Source product
          </div>
          <img
            src={creative.productImageUrl}
            alt=""
            style={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 6, background: '#f1f5f9' }}
          />
        </div>
      )}
    </>
  );
}

function ProductDetailBody({ product }: { product: ProductRow }) {
  const m = product.metrics;
  const trendLabel = m?.trendPct === null || m?.trendPct === undefined
    ? '—'
    : m.trendPct === 0 ? '—' : `${m.trendPct > 0 ? '↑' : '↓'}${Math.abs(m.trendPct)}%`;
  const trendColor = (m?.trendPct ?? 0) >= 25 ? '#047857'
    : (m?.trendPct ?? 0) <= -25 ? '#b91c1c'
    : '#475569';
  const tags = product.catalog_tags || [];
  const { data: daily } = useDailyMetrics('product', product.id);
  return (
    <>
      <div style={{ aspectRatio: '1', borderRadius: 8, overflow: 'hidden', background: '#f1f5f9', maxHeight: 360 }}>
        {(product.primary_image_url || product.image_url) ? (
          <img src={product.primary_image_url || product.image_url || ''} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontSize: 12 }}>No image</div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 11, color: '#64748b' }}>{product.brand || '—'}</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>{product.name || 'Unnamed product'}</div>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <MetricMiniCard label="Impressions 7d" value={(m?.impressions ?? 0).toLocaleString()} sub={m ? `was ${m.impressionsPrev.toLocaleString()}` : undefined} />
        <MetricMiniCard label="CTR" value={m && m.impressions > 0 ? `${(m.ctr * 100).toFixed(1)}%` : '—'} />
        <MetricMiniCard label="Clickouts" value={(m?.clickouts ?? 0).toLocaleString()} />
        <MetricMiniCard label="Trend" value={trendLabel} accent={trendColor} />
      </div>

      <div>
        <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700, marginBottom: 4 }}>
          Last 14 days
        </div>
        <DailySparkline data={daily} />
      </div>

      <div>
        <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700, marginBottom: 4 }}>
          Catalog tags ({tags.length})
        </div>
        {tags.length === 0 ? (
          <div style={{ fontSize: 12, color: '#94a3b8' }}>No catalogs tagged.</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {tags.map(t => (
              <span key={t} style={{ padding: '2px 8px', borderRadius: 4, background: '#eff6ff', color: '#1d4ed8', fontSize: 11, fontWeight: 600 }}>
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ── Phase 6: floating bulk-action bar ───────────────────────────────
interface BulkActionBarProps {
  count: number;
  catalogName: string;
  catalogNames: string[];
  looksCount: number;
  productsCount: number;
  busy: boolean;
  onClear: () => void;
  onRemove: () => void;
  onHide: () => void;
  onAddTo: (targetName: string) => void;
}

function BulkActionBar({ count, catalogName, catalogNames, looksCount, productsCount, busy, onClear, onRemove, onHide, onAddTo }: BulkActionBarProps) {
  const [showAddTo, setShowAddTo] = useState(false);
  const [addToQuery, setAddToQuery] = useState('');
  const candidates = useMemo(() => {
    const q = addToQuery.trim().toLowerCase();
    const sorted = [...catalogNames].sort((a, b) => a.localeCompare(b));
    return q ? sorted.filter(n => n.toLowerCase().includes(q)) : sorted;
  }, [catalogNames, addToQuery]);
  // Matches /admin/data's floating bulk bar — center-bottom, blurred
  // glass background, pill buttons. Stays inside the catalog dropdown
  // (`position: fixed` would float over other catalogs while scrolling).
  return (
    <div className="admin-bulk-bar" style={{
      position: 'fixed',
      left: '50%',
      bottom: 24,
      transform: 'translateX(-50%)',
      zIndex: 9999,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 16px',
      background: 'rgba(18, 18, 20, 0.97)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      color: '#fff',
      border: '1px solid rgba(255, 255, 255, 0.10)',
      borderRadius: 999,
      boxShadow: '0 18px 50px rgba(0, 0, 0, 0.45), 0 4px 14px rgba(0, 0, 0, 0.25)',
      animation: 'admin-bulk-bar-slide-up 220ms cubic-bezier(0.16, 1, 0.3, 1) both',
      maxWidth: 'calc(100vw - 32px)',
      flexWrap: 'wrap',
      justifyContent: 'center',
    }}>
      <style>{`
        @keyframes admin-bulk-bar-slide-up {
          from { transform: translate(-50%, 24px); opacity: 0; }
          to   { transform: translate(-50%, 0);    opacity: 1; }
        }
      `}</style>
      <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
        {count} selected
        {looksCount > 0 && productsCount > 0 ? ` · ${looksCount} look${looksCount === 1 ? '' : 's'}, ${productsCount} product${productsCount === 1 ? '' : 's'}` : ''}
      </span>
      <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.18)' }} />
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setShowAddTo(v => !v)}
          disabled={busy || catalogNames.length === 0}
          title={catalogNames.length === 0 ? 'No other catalogs available' : 'Add the selection to another catalog'}
          style={{
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.28)',
            color: '#fff',
            padding: '4px 12px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            cursor: busy ? 'wait' : (catalogNames.length === 0 ? 'not-allowed' : 'pointer'),
            opacity: catalogNames.length === 0 ? 0.45 : 1,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          Add to…
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        {showAddTo && (
          <div style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: 0,
            width: 240,
            maxHeight: 280,
            background: '#fff',
            color: '#0f172a',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            boxShadow: '0 18px 40px rgba(15,23,42,0.25)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}>
            <input
              autoFocus
              type="text"
              placeholder="Find a catalog…"
              value={addToQuery}
              onChange={e => setAddToQuery(e.target.value)}
              style={{
                padding: '8px 10px',
                fontSize: 12,
                border: 'none',
                borderBottom: '1px solid #f1f5f9',
                outline: 'none',
                background: '#fff',
              }}
            />
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {candidates.length === 0 ? (
                <div style={{ padding: 12, color: '#94a3b8', fontSize: 12 }}>No matches.</div>
              ) : (
                candidates.map(name => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      onAddTo(name);
                      setShowAddTo(false);
                      setAddToQuery('');
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '6px 12px',
                      border: 'none',
                      background: 'transparent',
                      color: '#0f172a',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#f1f5f9'}
                    onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
                  >
                    {name}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        title={`Strip "${catalogName}" from each selected item's catalog_tags`}
        style={{
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.28)',
          color: '#fff',
          padding: '4px 12px',
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 600,
          cursor: busy ? 'wait' : 'pointer',
        }}
      >
        {busy ? 'Working…' : `Remove from "${catalogName}"`}
      </button>
      {catalogName.toLowerCase() !== 'home' && (
        <button
          type="button"
          onClick={() => onAddTo('home')}
          disabled={busy}
          title="Append 'home' to each selected item's catalog_tags — they'll surface on the consumer landing feed"
          style={{
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.28)',
            color: '#fff',
            padding: '4px 12px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          ★ Promote to Home
        </button>
      )}
      <button
        type="button"
        onClick={onHide}
        disabled={busy || looksCount === 0}
        title={looksCount === 0 ? 'Select looks to hide' : 'Set looks.enabled = false'}
        style={{
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.28)',
          color: '#fff',
          padding: '4px 12px',
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 600,
          cursor: busy ? 'wait' : (looksCount === 0 ? 'not-allowed' : 'pointer'),
          opacity: looksCount === 0 ? 0.45 : 1,
        }}
      >
        Hide looks
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={busy}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'rgba(255,255,255,0.65)',
          padding: '4px 8px',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Clear
      </button>
    </div>
  );
}

// ── Spreadsheet / list view renderers ───────────────────────────────
// Compact tabular layout — same data, denser scan. Sortable upstream
// via MetricControlBar; clicking a row expands a preview on hover.

const listTableShellStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  overflow: 'hidden',
  fontSize: 12,
};

const listHeadCellStyle: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  fontWeight: 700,
  color: '#94a3b8',
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '1px solid #e5e7eb',
  background: '#f8fafc',
};

const listBodyCellStyle: React.CSSProperties = {
  padding: '7px 10px',
  borderBottom: '1px solid #f1f5f9',
  verticalAlign: 'middle',
};

function ListSectionHeader({ title, count, onAdd, addLabel, onRecommend, recommendLabel }: {
  title: string;
  count: number;
  onAdd?: () => void;
  addLabel?: string;
  onRecommend?: () => void;
  recommendLabel?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
      <h4 style={{ margin: 0, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#475569', fontWeight: 700 }}>{title}</h4>
      <span style={{ fontSize: 11, color: '#94a3b8' }}>{count}</span>
      <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
        {onAdd && (
          <button type="button" onClick={onAdd}
            className="admin-btn admin-btn-secondary"
            style={{ fontSize: 11, padding: '3px 10px' }}>
            {addLabel ?? '+ Add'}
          </button>
        )}
        {onRecommend && (
          <button type="button" onClick={onRecommend}
            className="admin-btn admin-btn-primary"
            style={{ fontSize: 11, padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, lineHeight: 1 }}>✨</span>
            {recommendLabel ?? 'Recommend'}
          </button>
        )}
      </div>
    </div>
  );
}

function MetricCells({ metrics }: { metrics?: ItemMetrics }) {
  if (!metrics) {
    return (
      <>
        <td style={{ ...listBodyCellStyle, color: '#cbd5e1' }}>—</td>
        <td style={{ ...listBodyCellStyle, color: '#cbd5e1' }}>—</td>
        <td style={{ ...listBodyCellStyle, color: '#cbd5e1' }}>—</td>
        <td style={{ ...listBodyCellStyle, color: '#cbd5e1' }}>—</td>
      </>
    );
  }
  const { impressions, ctr, clickouts, trendPct } = metrics;
  const trendLabel = trendPct === null ? 'NEW' : trendPct === 0 ? '—' : `${trendPct > 0 ? '↑' : '↓'}${Math.abs(trendPct)}%`;
  const trendColor = trendPct === null
    ? '#1d4ed8'
    : trendPct >= 25 ? '#047857'
    : trendPct <= -25 ? '#b91c1c'
    : '#475569';
  return (
    <>
      <td style={{ ...listBodyCellStyle, fontVariantNumeric: 'tabular-nums' }}>{impressions.toLocaleString()}</td>
      <td style={{ ...listBodyCellStyle, fontVariantNumeric: 'tabular-nums' }}>{impressions > 0 ? `${(ctr * 100).toFixed(1)}%` : '—'}</td>
      <td style={{ ...listBodyCellStyle, fontVariantNumeric: 'tabular-nums' }}>{clickouts}</td>
      <td style={{ ...listBodyCellStyle, color: trendColor, fontWeight: 700 }}>{trendLabel}</td>
    </>
  );
}

// ── Unified FEED row + table ──────────────────────────────────────────
// One row type spanning looks + products so the FEED renders both in a
// single ordered, interleaved table with a type chip per row.
export type FeedRow =
  | { kind: 'look'; id: string; key: string; metrics?: ItemMetrics; createdAt: string | null; look: CatalogLookRow }
  | { kind: 'product'; id: string; key: string; metrics?: ItemMetrics; createdAt: string | null; product: ProductRow };

function FeedTypeChip({ kind }: { kind: 'look' | 'product' }) {
  const isLook = kind === 'look';
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
      padding: '2px 7px', borderRadius: 999,
      background: isLook ? '#f0fdf4' : '#eff6ff',
      color: isLook ? '#15803d' : '#1d4ed8',
    }}>{isLook ? 'Look' : 'Product'}</span>
  );
}

// Gender chip — surfaces the per-item gender (Men / Women / Unisex /
// Untagged) in the FEED table so admins can scan whether the queue is
// gender-balanced without expanding rows. Untagged rows render a muted
// dash so a missing gender stands out as actionable.
function FeedGenderChip({ gender }: { gender?: string | null }) {
  const raw = (gender || '').toLowerCase().trim();
  // Looks store gender as 'men'/'women'; products store 'male'/'female'.
  // Normalize to the chip's vocabulary so look rows render their gender
  // instead of a "untagged" dash.
  const g = raw === 'men' ? 'male' : raw === 'women' ? 'female' : raw;
  if (g !== 'male' && g !== 'female' && g !== 'unisex') {
    return <span style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 600 }}>—</span>;
  }
  const palette = {
    male:   { bg: '#eff6ff', fg: '#1d4ed8', label: 'Men' },
    female: { bg: '#fdf2f8', fg: '#be185d', label: 'Women' },
    unisex: { bg: '#f1f5f9', fg: '#475569', label: 'Unisex' },
  }[g as 'male' | 'female' | 'unisex'];
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
      padding: '2px 7px', borderRadius: 999,
      background: palette.bg, color: palette.fg,
    }}>{palette.label}</span>
  );
}

function FeedListTable({
  rows,
  selectedLookIds,
  selectedProductIds,
  onSelectLook,
  onSelectProduct,
  onSelectAll,
  draggable,
  onReorder,
  onOpenDetail,
  onRemove,
}: {
  rows: FeedRow[];
  selectedLookIds?: Set<string>;
  selectedProductIds?: Set<string>;
  onSelectLook?: (id: string, index: number, extendRange: boolean) => void;
  onSelectProduct?: (id: string, index: number, extendRange: boolean) => void;
  onSelectAll?: (next: boolean) => void;
  draggable?: boolean;
  onReorder?: (from: number, to: number) => void;
  onOpenDetail?: (row: FeedRow) => void;
  /** Per-row "remove from this catalog" (minus button). */
  onRemove?: (row: FeedRow) => void;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  const isSelected = (row: FeedRow) =>
    row.kind === 'look' ? !!selectedLookIds?.has(row.id) : !!selectedProductIds?.has(row.id);
  const selectable = !!(onSelectLook || onSelectProduct);
  const allChecked = selectable && rows.length > 0 && rows.every(isSelected);
  const someChecked = selectable && !allChecked && rows.some(isSelected);

  return (
    <table style={{ ...listTableShellStyle, marginTop: 6 }}>
      <thead>
        <tr>
          {draggable && <th style={{ ...listHeadCellStyle, width: 22 }}></th>}
          {selectable && (
            <th style={{ ...listHeadCellStyle, width: 30 }}>
              <input
                type="checkbox"
                checked={allChecked}
                ref={el => { if (el) el.indeterminate = someChecked; }}
                onChange={() => onSelectAll?.(!allChecked)}
                onClick={e => e.stopPropagation()}
                title="Select all on this page"
              />
            </th>
          )}
          {onRemove && <th style={{ ...listHeadCellStyle, width: 30 }}></th>}
          <th style={{ ...listHeadCellStyle, width: 56 }}></th>
          <th style={listHeadCellStyle}>Title</th>
          <th style={{ ...listHeadCellStyle, width: 70 }}>Type</th>
          <th style={{ ...listHeadCellStyle, width: 84 }}>Gender</th>
          <th style={listHeadCellStyle}>Creator / Brand</th>
          <th style={listHeadCellStyle}>Impressions</th>
          <th style={listHeadCellStyle}>CTR</th>
          <th style={listHeadCellStyle}>Clickouts</th>
          <th style={listHeadCellStyle}>Trend</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => {
          const checked = isSelected(row);
          const isDropTarget = dropIdx === idx && dragIdx !== null && dragIdx !== idx;
          const dispatchSelect = (e: React.MouseEvent) => {
            if ((e.target as HTMLElement).closest('[data-role="metric-pill"]')) return;
            if ((e.target as HTMLElement).closest('[data-role="drag-handle"]')) return;
            if (row.kind === 'look') onSelectLook?.(row.id, idx, e.shiftKey);
            else onSelectProduct?.(row.id, idx, e.shiftKey);
          };
          return (
            <tr
              key={row.key}
              onClick={selectable ? dispatchSelect : undefined}
              onDragOver={draggable ? (e) => { if (dragIdx !== null) { e.preventDefault(); setDropIdx(idx); } } : undefined}
              onDrop={draggable ? (e) => {
                e.preventDefault();
                if (dragIdx !== null && dragIdx !== idx) onReorder?.(dragIdx, idx);
                setDragIdx(null); setDropIdx(null);
              } : undefined}
              style={{
                cursor: selectable ? 'pointer' : 'default',
                background: checked ? '#eff6ff' : 'transparent',
                boxShadow: isDropTarget ? 'inset 0 2px 0 0 #3b82f6' : 'none',
              }}
            >
              {draggable && (
                <td style={{ ...listBodyCellStyle, padding: 0, textAlign: 'center' }}>
                  <span
                    data-role="drag-handle"
                    draggable
                    onDragStart={(e) => { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragEnd={() => { setDragIdx(null); setDropIdx(null); }}
                    title="Drag to reorder"
                    style={{ display: 'inline-flex', cursor: 'grab', color: '#94a3b8', padding: '4px 2px', userSelect: 'none' }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <circle cx="9" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/>
                      <circle cx="15" cy="6" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="15" cy="18" r="1.6"/>
                    </svg>
                  </span>
                </td>
              )}
              {selectable && (
                <td style={listBodyCellStyle}>
                  <input type="checkbox" readOnly checked={checked} tabIndex={-1} />
                </td>
              )}
              {onRemove && (
                <td style={listBodyCellStyle}>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRemove(row); }}
                    title="Remove from this catalog"
                    aria-label="Remove from this catalog"
                    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', border: '1px solid #fecaca', background: '#fff', color: '#dc2626', cursor: 'pointer', lineHeight: 0 }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  </button>
                </td>
              )}
              <td style={listBodyCellStyle}>
                {row.kind === 'look' ? (
                  <div style={{ width: 36, height: 48, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                    {row.look.videoPath && (
                      <video
                        src={row.look.videoPath.startsWith('http') ? row.look.videoPath : `${import.meta.env.BASE_URL}${row.look.videoPath.replace(/^\//, '')}`}
                        muted playsInline preload="metadata"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    )}
                  </div>
                ) : (
                  (row.product.primary_image_url || row.product.image_url) ? (
                    <img src={row.product.primary_image_url || row.product.image_url || ''} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, background: '#f1f5f9' }} />
                  ) : (
                    <div style={{ width: 36, height: 36, background: '#f1f5f9', borderRadius: 4 }} />
                  )
                )}
              </td>
              <td
                style={{ ...listBodyCellStyle, fontWeight: 600, color: '#111', cursor: onOpenDetail ? 'pointer' : undefined }}
                onClick={onOpenDetail ? (e) => { e.stopPropagation(); onOpenDetail(row); } : undefined}
              >
                {row.kind === 'look' ? (row.look.title || `Look #${row.look.legacyId ?? ''}`) : (row.product.name || '—')}
              </td>
              <td style={listBodyCellStyle}><FeedTypeChip kind={row.kind} /></td>
              <td style={listBodyCellStyle}>
                <FeedGenderChip gender={row.kind === 'look' ? row.look.gender : row.product.gender} />
              </td>
              <td style={listBodyCellStyle}>
                {row.kind === 'look' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {row.look.creatorAvatarUrl ? (
                      <img src={row.look.creatorAvatarUrl} alt="" style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#e2e8f0' }} />
                    )}
                    <span style={{ color: '#111', fontWeight: 600 }}>{row.look.creatorName || row.look.creatorHandle || 'Unknown'}</span>
                  </div>
                ) : (
                  <span style={{ color: '#475569' }}>{row.product.brand || '—'}</span>
                )}
              </td>
              <MetricCells metrics={row.metrics} />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CreativesListTable({ title, creatives }: { title: string; creatives: CatalogCreativeVideo[] }) {
  if (creatives.length === 0) return (
    <div>
      <ListSectionHeader title={title} count={0} />
      <div style={{ padding: '10px 12px', color: '#94a3b8', fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 6, marginTop: 6 }}>
        No rendered creative in this section.
      </div>
    </div>
  );
  return (
    <div>
      <ListSectionHeader title={title} count={creatives.length} />
      <table style={{ ...listTableShellStyle, marginTop: 6 }}>
        <thead>
          <tr>
            <th style={{ ...listHeadCellStyle, width: 56 }}></th>
            <th style={listHeadCellStyle}>Title</th>
            <th style={listHeadCellStyle}>Brand</th>
            <th style={listHeadCellStyle}>Status</th>
            <th style={listHeadCellStyle}>Impressions</th>
            <th style={listHeadCellStyle}>CTR</th>
            <th style={listHeadCellStyle}>Clickouts</th>
            <th style={listHeadCellStyle}>Trend</th>
          </tr>
        </thead>
        <tbody>
          {creatives.map(c => (
            <tr key={c.id}>
              <td style={listBodyCellStyle}>
                {c.productImageUrl ? (
                  <img src={c.productImageUrl} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, background: '#f1f5f9' }} />
                ) : (
                  <div style={{ width: 36, height: 36, background: '#f1f5f9', borderRadius: 4 }} />
                )}
              </td>
              <td style={{ ...listBodyCellStyle, fontWeight: 600, color: '#111' }}>{c.productName || c.title || '—'}</td>
              <td style={{ ...listBodyCellStyle, color: '#475569' }}>{c.productBrand || '—'}</td>
              <td style={listBodyCellStyle}>
                <span style={{
                  fontSize: 10, padding: '2px 7px', borderRadius: 4,
                  background: c.status === 'live' ? '#10b981' : '#e5e7eb',
                  color: c.status === 'live' ? '#fff' : '#475569',
                  fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
                }}>{c.status}</span>
              </td>
              <MetricCells metrics={c.metrics} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Phase 5: sort + filter helpers shared by looks and products ─────
type MetricBearing = { metrics?: ItemMetrics; createdAt?: string | null };

// Category-group progression. The feed reads home → beauty →
// accessories → footwear → apparel as a coherent journey, rather than
// candle-next-to-tshirt-next-to-chair chaos. Within each group, the
// best-performing types lead; within each type, best-performing items
// lead. Anything unrecognised falls into 'other' at the tail.
const CATEGORY_GROUP_ORDER = [
  'home', 'beauty', 'accessories', 'footwear', 'tops', 'bottoms', 'full-look', 'other',
] as const;
type CategoryGroup = typeof CATEGORY_GROUP_ORDER[number];

const TYPE_TO_GROUP: Record<string, CategoryGroup> = {
  // Home
  'home fragrance': 'home',
  decor:            'home',
  candle:           'home',
  candles:          'home',
  food:             'home',
  electronics:      'home',
  book:             'home',
  // Beauty
  skincare:         'beauty',
  haircare:         'beauty',
  beauty:           'beauty',
  fragrance:        'beauty',
  makeup:           'beauty',
  // Accessories
  sunglasses:       'accessories',
  bag:              'accessories',
  belt:             'accessories',
  jewelry:          'accessories',
  watch:            'accessories',
  hat:              'accessories',
  scarf:            'accessories',
  // Footwear
  shoes:            'footwear',
  sneakers:         'footwear',
  boots:            'footwear',
  sandals:          'footwear',
  // Apparel tops
  top:              'tops',
  shirt:            'tops',
  't-shirt':        'tops',
  sweater:          'tops',
  jacket:           'tops',
  activewear:       'tops',
  coat:             'tops',
  hoodie:           'tops',
  blazer:           'tops',
  // Apparel bottoms
  pants:            'bottoms',
  shorts:           'bottoms',
  skirt:            'bottoms',
  jeans:            'bottoms',
  // Full-look
  dress:            'full-look',
  jumpsuit:         'full-look',
};

function classifyType(type: string | null | undefined): CategoryGroup {
  if (!type) return 'other';
  return TYPE_TO_GROUP[type.trim().toLowerCase()] ?? 'other';
}

// Recommend Order — bandit-style scoring + topical clustering.
//   - Per-item score: EXPLOIT (clickout-rate + CTR) blended with
//     EXPLORE (UCB to surface under-tested items), normalised to [0,1].
//   - Products cluster by type, then by category-group (HOME → BEAUTY
//     → ACCESSORIES → FOOTWEAR → TOPS → BOTTOMS → FULL-LOOK → OTHER)
//     so the feed reads as a coherent journey instead of random chaos.
//   - Inside a category-group, types are ordered by per-type aggregate
//     score (sum-of-impressions weighted by CTR + clickouts).
//   - Inside a type, items are ordered by per-item score.
//   - Looks stay score-sorted (no taxonomy on looks today) and interleave
//     ~2 looks : 1 product over the type-clustered product stream.
function recommendFeedOrder(
  looks: { id: string; metrics?: ItemMetrics }[],
  products: { id: string; type?: string | null; metrics?: ItemMetrics }[],
): string[] {
  const all = [
    ...looks.map(l => ({ key: `look:${l.id}`, kind: 'look' as const, type: null as string | null, m: l.metrics })),
    ...products.map(p => ({ key: `product:${p.id}`, kind: 'product' as const, type: p.type ?? null, m: p.metrics })),
  ];
  if (all.length === 0) return [];
  const totalImp = all.reduce((s, x) => s + (x.m?.impressions ?? 0), 0) + 1;
  const enriched = all.map(x => {
    const imp = x.m?.impressions ?? 0;
    const clk = x.m?.clickouts ?? 0;
    const ctr = x.m?.ctr ?? 0;
    const exploit = 0.7 * (imp > 0 ? clk / imp : 0) + 0.3 * ctr;       // blended conversion
    const explore = Math.sqrt(Math.log(totalImp + 1) / (imp + 1));     // UCB: ↑ when under-tested
    return { ...x, imp, clk, ctr, exploit, explore };
  });
  const norm = (vals: number[]) => {
    let mn = Infinity, mx = -Infinity;
    for (const v of vals) { if (v < mn) mn = v; if (v > mx) mx = v; }
    const range = mx - mn || 1;
    return (v: number) => (v - mn) / range;
  };
  const exploitN = norm(enriched.map(e => e.exploit));
  const exploreN = norm(enriched.map(e => e.explore));
  const EXPLORE_W = 0.6; // proven winners still beat unproven, but unproven beats proven-mediocre
  const scored = enriched.map(e => ({
    key: e.key,
    kind: e.kind,
    type: e.type,
    imp: e.imp,
    clk: e.clk,
    ctr: e.ctr,
    score: exploitN(e.exploit) + EXPLORE_W * exploreN(e.explore),
  }));

  // Looks: best-first; no taxonomy.
  const looksSorted = scored.filter(s => s.kind === 'look').sort((a, b) => b.score - a.score);

  // Products: bucket by type. Compute a per-type performance score so
  // the highest-converting types lead inside their category-group.
  const products_ = scored.filter(s => s.kind === 'product');
  const byType = new Map<string, typeof products_>();
  for (const p of products_) {
    const key = p.type ?? '__null__';
    const bucket = byType.get(key) ?? [];
    bucket.push(p);
    byType.set(key, bucket);
  }
  // Per-type aggregate: average per-item score weighted by impression
  // volume (so types with one lucky high-CTR item don't trump types with
  // a deep, consistently-performing roster). Falls back to plain average
  // when nothing in the type has been impressed yet.
  const typeAgg = new Map<string, number>();
  for (const [t, items] of byType) {
    const totalW = items.reduce((s, x) => s + Math.max(1, x.imp), 0);
    const weighted = items.reduce((s, x) => s + x.score * Math.max(1, x.imp), 0);
    typeAgg.set(t, totalW > 0 ? weighted / totalW : 0);
  }
  // Order types within each category-group by aggregate score.
  const typesByGroup = new Map<CategoryGroup, string[]>();
  for (const t of byType.keys()) {
    const g = classifyType(t === '__null__' ? null : t);
    const list = typesByGroup.get(g) ?? [];
    list.push(t);
    typesByGroup.set(g, list);
  }
  for (const [, list] of typesByGroup) {
    list.sort((a, b) => (typeAgg.get(b) ?? 0) - (typeAgg.get(a) ?? 0));
  }
  // Walk groups in the canonical progression, emit each type's items
  // best-first inside the type.
  const prodsClustered: typeof products_ = [];
  for (const g of CATEGORY_GROUP_ORDER) {
    const types = typesByGroup.get(g);
    if (!types) continue;
    for (const t of types) {
      const items = byType.get(t);
      if (!items) continue;
      items.sort((a, b) => b.score - a.score);
      prodsClustered.push(...items);
    }
  }

  // Interleave ~2 looks : 1 product, preserving look-stream order and
  // the type-clustered product stream.
  const out: string[] = [];
  let li = 0, pi = 0;
  while (li < looksSorted.length || pi < prodsClustered.length) {
    for (let k = 0; k < 2 && li < looksSorted.length; k++) out.push(looksSorted[li++].key);
    if (pi < prodsClustered.length) out.push(prodsClustered[pi++].key);
  }
  return out;
}

function sortAndFilterItems<T extends MetricBearing>(items: T[], sort: MetricSort, filter: MetricFilter): T[] {
  const FRESH_DAYS = 14;
  const ZOMBIE_THRESHOLD = 0; // zero impressions in window = zombie
  const RISING_PCT = 25;
  const FALLING_PCT = -25;
  const cutoff = Date.now() - FRESH_DAYS * 86400_000;

  const filtered = items.filter(it => {
    const m = it.metrics;
    const impressions = m?.impressions ?? 0;
    const trend = m?.trendPct ?? null;
    switch (filter) {
      case 'rising': return trend !== null && trend >= RISING_PCT;
      case 'falling': return trend !== null && trend <= FALLING_PCT;
      case 'zombie': return impressions <= ZOMBIE_THRESHOLD;
      case 'never-viewed': return impressions === 0;
      default: return true;
    }
  });

  const cmp = (a: T, b: T): number => {
    const am = a.metrics; const bm = b.metrics;
    switch (sort) {
      case 'highest-ctr': return (bm?.ctr ?? 0) - (am?.ctr ?? 0);
      case 'biggest-riser': {
        const at = am?.trendPct ?? -Infinity;
        const bt = bm?.trendPct ?? -Infinity;
        return bt - at;
      }
      case 'biggest-faller': {
        const at = am?.trendPct ?? Infinity;
        const bt = bm?.trendPct ?? Infinity;
        return at - bt;
      }
      case 'newest': {
        const at = a.createdAt ? Date.parse(a.createdAt) : 0;
        const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
        return bt - at;
      }
      case 'never-viewed': {
        const ai = am?.impressions ?? 0;
        const bi = bm?.impressions ?? 0;
        if (ai === 0 && bi === 0) {
          // tiebreak by newest
          const at = a.createdAt ? Date.parse(a.createdAt) : 0;
          const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
          return bt - at;
        }
        return ai - bi;
      }
      case 'most-viewed':
      default:
        return (bm?.impressions ?? 0) - (am?.impressions ?? 0);
    }
  };

  // Unused FRESH_DAYS cutoff retained for future "stale" filter; quiet
  // the linter without changing behaviour.
  void cutoff;
  return [...filtered].sort(cmp);
}

// ── Phase 7-lite: header KPI strip ──────────────────────────────────
interface KpiSnapshot {
  totalImpressions: number;
  totalClickouts: number;
  blendedCtr: number;
  risers: number;
  fallers: number;
  zeroViewPct: number;
  itemsCount: number;
}

function buildKpiStrip(items: MetricBearing[]): KpiSnapshot {
  let imp = 0, clk = 0, co = 0, risers = 0, fallers = 0, zero = 0;
  for (const it of items) {
    const m = it.metrics;
    if (!m) { zero++; continue; }
    imp += m.impressions;
    clk += m.clicks;
    co += m.clickouts;
    if ((m.trendPct ?? 0) >= 25) risers++;
    if ((m.trendPct ?? 0) <= -25) fallers++;
    if (m.impressions === 0) zero++;
  }
  return {
    totalImpressions: imp,
    totalClickouts: co,
    blendedCtr: imp > 0 ? clk / imp : 0,
    risers,
    fallers,
    zeroViewPct: items.length > 0 ? zero / items.length : 0,
    itemsCount: items.length,
  };
}

function KpiStrip({ kpi, metricsLoading }: { kpi: KpiSnapshot; metricsLoading: boolean }) {
  const cell = (label: string, value: string, accent?: string, sub?: string) => (
    <div style={{ flex: '1 1 0', padding: '8px 12px', borderRight: '1px solid #e5e7eb', minWidth: 0 }}>
      <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: accent || '#0f172a', lineHeight: 1.15 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#64748b', marginTop: 1 }}>{sub}</div>}
    </div>
  );
  return (
    <div style={{
      display: 'flex',
      alignItems: 'stretch',
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      overflow: 'hidden',
      opacity: metricsLoading ? 0.65 : 1,
      transition: 'opacity 120ms',
    }}>
      {cell('Impressions 7d', kpi.totalImpressions.toLocaleString())}
      {cell('Clickouts 7d', kpi.totalClickouts.toLocaleString())}
      {cell('Blended CTR', `${(kpi.blendedCtr * 100).toFixed(1)}%`)}
      {cell('Rising', String(kpi.risers), '#047857', '+25% vs prior')}
      {cell('Falling', String(kpi.fallers), '#b91c1c', '−25% vs prior')}
      <div style={{ flex: '1 1 0', padding: '8px 12px', minWidth: 0 }}>
        <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>Dark inventory</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: kpi.zeroViewPct > 0.4 ? '#b91c1c' : '#0f172a', lineHeight: 1.15 }}>
          {(kpi.zeroViewPct * 100).toFixed(0)}%
        </div>
        <div style={{ fontSize: 10, color: '#64748b', marginTop: 1 }}>of {kpi.itemsCount} items had 0 views</div>
      </div>
    </div>
  );
}

// ── Phase 5 control bar ─────────────────────────────────────────────
interface MetricControlBarProps {
  sort: MetricSort;
  viewMode: ViewMode;
  onSort: (s: MetricSort) => void;
  onViewMode: (v: ViewMode) => void;
}

function MetricControlBar({ sort, viewMode, onSort, onViewMode }: MetricControlBarProps) {
  // "View as" — switches the catalog preview into a synthetic shopper
  // gender so admins can sanity-check what a male or female user would
  // actually see in the consumer feed without signing in/out. Wired
  // through the same setShopperGender singleton that gates the home
  // feed, so the underlying product lists re-rank live.
  const [viewAs, setViewAs] = useState<'unknown' | 'male' | 'female'>(() => getShopperGender());
  useEffect(() => {
    return subscribeToShopperGender(g => setViewAs(g));
  }, []);
  const sortOpts: { value: MetricSort; label: string }[] = [
    { value: 'most-viewed', label: 'Most viewed' },
    { value: 'highest-ctr', label: 'Highest CTR' },
    { value: 'biggest-riser', label: 'Biggest riser' },
    { value: 'biggest-faller', label: 'Biggest faller' },
    { value: 'newest', label: 'Newest' },
    { value: 'never-viewed', label: 'Never viewed' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#475569' }}>
        Sort
        <select
          value={sort}
          onChange={e => onSort(e.target.value as MetricSort)}
          style={{ fontSize: 12, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff' }}
        >
          {sortOpts.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#475569' }}>
        View as
        <select
          value={viewAs}
          onChange={e => {
            const next = e.target.value as 'unknown' | 'male' | 'female';
            setViewAs(next);
            setShopperGender(next);
          }}
          style={{ fontSize: 12, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff' }}
          title="Preview the catalog as a shopper of this gender — re-ranks the feed live."
        >
          <option value="unknown">Anyone</option>
          <option value="male">Men</option>
          <option value="female">Women</option>
        </select>
      </label>
      <div style={{ marginLeft: 'auto', display: 'inline-flex', border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
        <button
          type="button"
          onClick={() => onViewMode('grid')}
          title="Grid view"
          aria-label="Grid view"
          style={{
            padding: '4px 10px',
            border: 'none',
            background: viewMode === 'grid' ? '#111' : '#fff',
            color: viewMode === 'grid' ? '#fff' : '#475569',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          Grid
        </button>
        <button
          type="button"
          onClick={() => onViewMode('list')}
          title="Spreadsheet / list view"
          aria-label="List view"
          style={{
            padding: '4px 10px',
            border: 'none',
            borderLeft: '1px solid #e2e8f0',
            background: viewMode === 'list' ? '#111' : '#fff',
            color: viewMode === 'list' ? '#fff' : '#475569',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          List
        </button>
      </div>
    </div>
  );
}

// ── Phases 3 + 4: per-tile metric overlay for products ──────────────
function ProductMetricTile({ product, selected, onSelect, onOpenDetail }: { product: ProductRow; selected?: boolean; onSelect?: (extendRange: boolean) => void; onOpenDetail?: () => void }) {
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!onSelect) return;
    e.preventDefault();
    onSelect(e.shiftKey);
  }, [onSelect]);
  return (
    <div
      onClick={handleClick}
      style={{
        border: `2px solid ${selected ? '#2563eb' : '#e5e7eb'}`,
        borderRadius: 6,
        overflow: 'hidden',
        background: '#fff',
        position: 'relative',
        cursor: onSelect ? 'pointer' : 'default',
        outline: selected ? '2px solid #bfdbfe' : 'none',
        outlineOffset: -4,
      }}
      title={[product.brand, product.name].filter(Boolean).join(' · ')}
    >
      {(product.primary_image_url || product.image_url) ? (
        <img src={product.primary_image_url || product.image_url || ''} alt={product.name ?? ''} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block', background: '#f5f5f5' }} />
      ) : (
        <div style={{ width: '100%', aspectRatio: '1', background: '#f5f5f5' }} />
      )}
      {/* Selection + expand-to-detail are interaction affordances and stay.
          The metric badge row (impressions / CTR / NEW) and brand+name
          caption were stripped per request — the grid is now image-only,
          with hover tooltip carrying the metadata. */}
      {selected && <SelectionBadge />}
      {onOpenDetail && <ExpandTileButton onClick={onOpenDetail} />}
    </div>
  );
}

function ExpandTileButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title="Open detail drawer"
      style={{
        position: 'absolute',
        bottom: 6,
        left: 6,
        width: 22,
        height: 22,
        borderRadius: '50%',
        border: 'none',
        background: 'rgba(15,23,42,0.6)',
        color: '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        zIndex: 3,
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 3 21 3 21 9"/>
        <polyline points="9 21 3 21 3 15"/>
        <line x1="21" y1="3" x2="14" y2="10"/>
        <line x1="3" y1="21" x2="10" y2="14"/>
      </svg>
    </button>
  );
}

function SelectionBadge() {
  return (
    <span style={{
      position: 'absolute',
      bottom: 6,
      right: 6,
      width: 18,
      height: 18,
      borderRadius: '50%',
      background: '#2563eb',
      color: '#fff',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none',
      boxShadow: '0 1px 3px rgba(15,23,42,0.35)',
    }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </span>
  );
}

// Base style for every chip in MetricBadgeRow. Must be declared
// BEFORE the components that read it — Rollup converts the function
// declarations to const expressions during minification, and an
// out-of-order const reference can TDZ on first access. That was
// the cause of the production "Cannot access 'Le'/'Fe' before
// initialization" 500 on /admin/catalogs and /admin/data.
const metricChipBase: React.CSSProperties = {
  padding: '1px 6px',
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.3px',
  lineHeight: '14px',
  cursor: 'help',
};

// Shared metric strip used by both LookThumb and ProductMetricTile.
// Hovering the chip cluster opens a rich insights popover with the
// underlying numbers, prior period, derived rates and a textual
// trend interpretation. Native title= tooltips remain as a fallback
// for accessibility / keyboard users.
function MetricBadgeRow({ metrics }: { metrics?: ItemMetrics }) {
  const [showInsights, setShowInsights] = React.useState(false);

  if (!metrics) {
    return (
      <div style={{ position: 'absolute', top: 6, left: 6, right: 6, display: 'flex', gap: 4 }}>
        <span style={{ ...metricChipBase, background: 'rgba(15,23,42,0.45)', color: '#fff' }}>—</span>
      </div>
    );
  }
  const { impressions, clicks, clickouts, impressionsPrev, ctr, clickoutRate, trendPct } = metrics;
  const trendLabel = trendPct === null
    ? 'NEW'
    : trendPct === 0 ? '—' : `${trendPct > 0 ? '↑' : '↓'}${Math.abs(trendPct)}%`;
  const trendColor = trendPct === null
    ? '#1d4ed8'
    : trendPct >= 25 ? '#047857'
    : trendPct <= -25 ? '#b91c1c'
    : '#475569';

  return (
    <div
      data-role="metric-pill"
      onClick={(e) => e.stopPropagation()}
      style={{ position: 'absolute', top: 6, left: 6, right: 6, display: 'flex', gap: 4, flexWrap: 'wrap', pointerEvents: 'auto', zIndex: 2 }}
      onMouseEnter={() => setShowInsights(true)}
      onMouseLeave={() => setShowInsights(false)}
    >
      <span style={{ ...metricChipBase, background: 'rgba(15,23,42,0.78)', color: '#fff' }}>
        {impressions >= 1000 ? `${(impressions / 1000).toFixed(1)}k` : impressions}
      </span>
      {impressions > 0 && (
        <span style={{ ...metricChipBase, background: 'rgba(15,23,42,0.78)', color: '#fff' }}>
          {(ctr * 100).toFixed(0)}%
        </span>
      )}
      <span style={{ ...metricChipBase, background: trendColor, color: '#fff' }}>
        {trendLabel}
      </span>
      {showInsights && (
        <MetricInsightsPopover
          impressions={impressions}
          impressionsPrev={impressionsPrev}
          clicks={clicks}
          clickouts={clickouts}
          ctr={ctr}
          clickoutRate={clickoutRate}
          trendPct={trendPct}
        />
      )}
    </div>
  );
}

// Rich hover popover. Positioned below + slightly right of the chip
// cluster. Doesn't try to be the world's smartest popover — no flip
// logic — but it's contained within the dropdown's scroll surface so
// clipping is rarely an issue.
interface MetricInsightsPopoverProps {
  impressions: number;
  impressionsPrev: number;
  clicks: number;
  clickouts: number;
  ctr: number;
  clickoutRate: number;
  trendPct: number | null;
}

function MetricInsightsPopover({
  impressions, impressionsPrev, clicks, clickouts, ctr, clickoutRate, trendPct,
}: MetricInsightsPopoverProps) {
  const trendVerdict = trendPct === null
    ? 'New this week — no prior period to compare.'
    : trendPct >= 50 ? 'Breaking out.'
    : trendPct >= 25 ? 'Rising fast.'
    : trendPct > 0 ? 'Trending up.'
    : trendPct === 0 ? 'Flat vs prior 7d.'
    : trendPct >= -25 ? 'Slipping.'
    : 'Fell off — investigate.';
  const trendColor = trendPct === null
    ? '#1d4ed8'
    : trendPct >= 25 ? '#047857'
    : trendPct <= -25 ? '#b91c1c'
    : '#475569';
  const row = (label: string, value: string, hint?: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '3px 0' }}>
      <span style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px', fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 12, color: '#0f172a', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {value}
        {hint && <span style={{ marginLeft: 4, fontSize: 9, color: '#94a3b8', fontWeight: 500 }}>{hint}</span>}
      </span>
    </div>
  );
  return (
    <div
      role="tooltip"
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        left: 0,
        width: 220,
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        boxShadow: '0 10px 28px rgba(15,23,42,0.18)',
        padding: 10,
        zIndex: 10,
        pointerEvents: 'none',
        textAlign: 'left',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Insights · 7d</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: trendColor }}>
          {trendPct === null ? 'NEW' : trendPct === 0 ? '—' : `${trendPct > 0 ? '+' : ''}${trendPct}%`}
        </span>
      </div>
      {row('Impressions', impressions.toLocaleString(), `was ${impressionsPrev.toLocaleString()}`)}
      {row('Clicks', clicks.toLocaleString(), impressions > 0 ? `${(ctr * 100).toFixed(1)}% CTR` : undefined)}
      {row('Clickouts', clickouts.toLocaleString(), impressions > 0 ? `${(clickoutRate * 100).toFixed(2)}% rate` : undefined)}
      <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #f1f5f9', fontSize: 11, color: trendColor, fontWeight: 600 }}>
        {trendVerdict}
      </div>
    </div>
  );
}

interface DraggableSectionProps {
  title: string;
  count: number;
  emptyMessage: string;
  minColumnPx: number;
  draggable: boolean;
  onReorder: (fromIndex: number, toIndex: number) => void;
  /** Inline "+ Add" + "✨ Recommend" CTAs next to the section title. */
  onAdd?: () => void;
  addLabel?: string;
  onRecommend?: () => void;
  recommendLabel?: string;
  children: React.ReactNode;
}

function DraggableSection({ title, count, emptyMessage, minColumnPx, draggable, onReorder, onAdd, addLabel, onRecommend, recommendLabel, children }: DraggableSectionProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const items = React.Children.toArray(children);

  const handleDragStart = (idx: number) => (e: React.DragEvent) => {
    if (!draggable) return;
    setDragIndex(idx);
    e.dataTransfer.effectAllowed = 'move';
    // Required for Firefox to initiate a drag.
    e.dataTransfer.setData('text/plain', String(idx));
  };
  const handleDragOver = (idx: number) => (e: React.DragEvent) => {
    if (!draggable || dragIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (overIndex !== idx) setOverIndex(idx);
  };
  const handleDrop = (idx: number) => (e: React.DragEvent) => {
    if (!draggable || dragIndex === null) return;
    e.preventDefault();
    if (dragIndex !== idx) onReorder(dragIndex, idx);
    setDragIndex(null);
    setOverIndex(null);
  };
  const handleDragEnd = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#111', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {title}
        </h3>
        <span style={{ fontSize: 11, color: '#888' }}>{count}</span>
        <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
          {onAdd && (
            <button type="button" onClick={onAdd}
              className="admin-btn admin-btn-secondary"
              style={{ fontSize: 11, padding: '3px 10px' }}>
              {addLabel ?? '+ Add'}
            </button>
          )}
          {onRecommend && (
            <button type="button" onClick={onRecommend}
              className="admin-btn admin-btn-primary"
              style={{ fontSize: 11, padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 12, lineHeight: 1 }}>✨</span>
              {recommendLabel ?? 'Recommend'}
            </button>
          )}
        </div>
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: '#888' }}>{emptyMessage}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${minColumnPx}px, 1fr))`, gap: 8 }}>
          {items.map((child, idx) => (
            <div
              key={idx}
              draggable={draggable}
              onDragStart={handleDragStart(idx)}
              onDragOver={handleDragOver(idx)}
              onDrop={handleDrop(idx)}
              onDragEnd={handleDragEnd}
              style={{
                cursor: draggable ? (dragIndex === idx ? 'grabbing' : 'grab') : 'default',
                opacity: dragIndex === idx ? 0.4 : 1,
                outline: draggable && overIndex === idx && dragIndex !== idx ? '2px solid #2563eb' : 'none',
                outlineOffset: -2,
                borderRadius: 6,
                transition: 'opacity 120ms ease',
              }}
            >
              {child}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LookThumb({ look, selected, onSelect, onOpenDetail }: { look: CatalogLookRow; selected?: boolean; onSelect?: (extendRange: boolean) => void; onOpenDetail?: () => void }) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const src = look.videoPath
    ? (look.videoPath.startsWith('http') ? look.videoPath : `${import.meta.env.BASE_URL}${look.videoPath.replace(/^\//, '')}`)
    : null;

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!onSelect) return;
    // Don't intercept clicks that started on the metric pill cluster
    // (those open the insights popover — let them through). The
    // MetricBadgeRow sets pointer-events: auto so cursor: help is
    // reachable; this guards against accidental selection toggle.
    const tgt = e.target as HTMLElement;
    if (tgt.closest('[data-role="metric-pill"]')) return;
    e.preventDefault();
    onSelect(e.shiftKey);
  }, [onSelect]);

  return (
    <div
      onClick={handleClick}
      style={{
        border: `2px solid ${selected ? '#2563eb' : '#e5e7eb'}`,
        borderRadius: 6,
        overflow: 'hidden',
        background: '#111',
        cursor: onSelect ? 'pointer' : 'default',
        outline: selected ? '2px solid #bfdbfe' : 'none',
        outlineOffset: -4,
        position: 'relative',
      }}
      onMouseEnter={() => { videoRef.current?.play().catch(() => {}); }}
      onMouseLeave={() => { if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = 0; } }}
    >
      <div style={{ width: '100%', aspectRatio: '9/16', background: '#000', position: 'relative' }}>
        {src ? (
          <video
            ref={videoRef}
            src={src}
            muted
            loop
            playsInline
            preload="metadata"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontSize: 11 }}>
            No video
          </div>
        )}
        <MetricBadgeRow metrics={look.metrics} />
        {selected && <SelectionBadge />}
        {onOpenDetail && <ExpandTileButton onClick={onOpenDetail} />}
      </div>
      <div style={{ padding: 6, background: '#fff' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {look.title || `Look #${look.legacyId ?? ''}`}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
          {look.creatorAvatarUrl ? (
            <img
              src={look.creatorAvatarUrl}
              alt=""
              style={{ width: 16, height: 16, borderRadius: '50%', objectFit: 'cover', background: '#f1f5f9', flexShrink: 0 }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
            />
          ) : (
            <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#e2e8f0', flexShrink: 0 }} />
          )}
          <div style={{ fontSize: 10, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
            <span style={{ fontWeight: 600, color: '#111' }}>{look.creatorName || look.creatorHandle || 'Unknown'}</span>
            {look.creatorHandle && look.creatorName ? <span style={{ color: '#94a3b8' }}> · @{look.creatorHandle}</span> : null}
          </div>
        </div>
        <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
          {look.productCount} product{look.productCount === 1 ? '' : 's'}
        </div>
      </div>
    </div>
  );
}

function CreativeThumb({ creative, onOpenDetail }: { creative: CatalogCreativeVideo; onOpenDetail?: () => void }) {
  // Default poster is the product's catalog image (the merchandised
  // still — e.g. the New Balance sneaker on a clean background); we
  // only swap to the rendered creative video on hover so the grid
  // reads as "products you can search through" until the admin
  // explicitly inspects one. Fallback chain: product image →
  // creative thumbnail (poster frame extracted from the video) →
  // dark placeholder.
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [hover, setHover] = React.useState(false);
  const [videoLoaded, setVideoLoaded] = React.useState(false);
  const label = creative.productName || creative.title || 'Creative';
  const posterSrc = creative.productImageUrl || creative.thumbnailUrl || null;

  return (
    <div
      style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden', background: '#111' }}
      onMouseEnter={() => {
        setHover(true);
        videoRef.current?.play().catch(() => {});
      }}
      onMouseLeave={() => {
        setHover(false);
        if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = 0; }
      }}
    >
      <div style={{ width: '100%', aspectRatio: '9/16', background: '#000', position: 'relative' }}>
        {posterSrc && (
          <img
            src={posterSrc}
            alt=""
            style={{
              width: '100%', height: '100%', objectFit: 'cover', display: 'block',
              position: 'absolute', inset: 0,
              // Fade the poster out once the video is loaded AND we're
              // hovering — keeps the swap clean instead of a hard cut.
              opacity: hover && videoLoaded ? 0 : 1,
              transition: 'opacity 120ms ease',
            }}
          />
        )}
        <video
          ref={videoRef}
          src={creative.videoUrl}
          poster={creative.thumbnailUrl ?? undefined}
          muted
          loop
          playsInline
          // metadata until first hover; switch to auto so the next
          // hover gets an instant play. Keeps page-load light when
          // there are 100+ tiles below the fold.
          preload={hover ? 'auto' : 'metadata'}
          onLoadedData={() => setVideoLoaded(true)}
          style={{
            width: '100%', height: '100%', objectFit: 'cover', display: 'block',
            position: 'absolute', inset: 0,
            opacity: hover ? 1 : 0,
            transition: 'opacity 120ms ease',
          }}
        />
        <span style={{
          position: 'absolute', top: 6, right: 6,
          padding: '2px 6px', borderRadius: 3,
          fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
          background: creative.status === 'live' ? '#10b981' : 'rgba(17,24,39,0.75)',
          color: '#fff',
        }}>
          {creative.status}
        </span>
        {onOpenDetail && <ExpandTileButton onClick={onOpenDetail} />}
      </div>
      <div style={{ padding: 6, background: '#fff' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </div>
        <div style={{ fontSize: 10, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {creative.productBrand || ' - '}
        </div>
      </div>
    </div>
  );
}

interface AddProductsModalProps {
  catalog: Catalog;
  products: ProductRow[];
  search: string;
  onSearch: (value: string) => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  busy: boolean;
  autoPicking: boolean;
  autoProgress: { done: number; total: number } | null;
  onAutoPick: () => void;
  onClose: () => void;
  onCommit: () => void;
}

// Sortable columns for the products picker. Names mirror the /admin/data
// Products tab so an admin who knows that page can sort the same way here.
type ProductSortKey = 'name' | 'brand' | 'type' | 'gender' | 'price' | 'video' | 'created';
type SortDir = 'asc' | 'desc';

// Pull a numeric value out of a price string like "$1,299.00" or "€89,50".
// Returns NaN when the string is empty so unrelated rows fall to the end.
function priceAsNumber(s: string | null | undefined): number {
  if (!s) return NaN;
  const m = s.replace(/,/g, '').match(/[\d.]+/);
  return m ? parseFloat(m[0]) : NaN;
}

function compareProducts(a: ProductRow, b: ProductRow, key: ProductSortKey, dir: SortDir): number {
  const mul = dir === 'asc' ? 1 : -1;
  switch (key) {
    case 'name':   return ((a.name   || '').toLowerCase()).localeCompare((b.name   || '').toLowerCase()) * mul;
    case 'brand':  return ((a.brand  || '').toLowerCase()).localeCompare((b.brand  || '').toLowerCase()) * mul;
    case 'type':   return ((a.type   || '').toLowerCase()).localeCompare((b.type   || '').toLowerCase()) * mul;
    case 'gender': return ((a.gender || '').toLowerCase()).localeCompare((b.gender || '').toLowerCase()) * mul;
    case 'price': {
      const pa = priceAsNumber(a.price); const pb = priceAsNumber(b.price);
      // NaNs always sink to the bottom regardless of direction.
      if (isNaN(pa) && isNaN(pb)) return 0;
      if (isNaN(pa)) return 1;
      if (isNaN(pb)) return -1;
      return (pa - pb) * mul;
    }
    case 'video':  return (Number(Boolean(b.primary_video_url)) - Number(Boolean(a.primary_video_url))) * mul;
    case 'created': {
      const da = a.createdAt ? Date.parse(a.createdAt) : 0;
      const db = b.createdAt ? Date.parse(b.createdAt) : 0;
      return (db - da) * mul;
    }
  }
}

export function AddProductsModal({
  catalog,
  products,
  search,
  onSearch,
  selected,
  onToggle,
  busy,
  autoPicking,
  autoProgress,
  onAutoPick,
  onClose,
  onCommit,
}: AddProductsModalProps) {
  const [sortKey, setSortKey] = useState<ProductSortKey>('created');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const tagged = useMemo(
    () => new Set(products.filter(p => (p.catalog_tags || []).includes(catalog.name)).map(p => p.id)),
    [products, catalog.name],
  );

  // Filter + sort. The picker now matches the Data products page in shape:
  // primary image, name, brand, type, gender, price, video, added — all
  // sortable. Filtering checks every text-y field so a search like "tee"
  // matches names AND types, "alo" matches brands AND names.
  const filteredAndSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = !q ? products : products.filter(p =>
      (p.name   || '').toLowerCase().includes(q)
      || (p.brand  || '').toLowerCase().includes(q)
      || (p.type   || '').toLowerCase().includes(q)
      || (p.gender || '').toLowerCase().includes(q),
    );
    return [...filtered].sort((a, b) => compareProducts(a, b, sortKey, sortDir));
  }, [products, search, sortKey, sortDir]);

  // Click a header to sort by that column. Re-click flips direction; switching
  // columns resets direction to the natural default (text asc, dates/video desc).
  const onHeaderClick = (key: ProductSortKey) => {
    if (sortKey === key) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return; }
    setSortKey(key);
    setSortDir(key === 'created' || key === 'video' || key === 'price' ? 'desc' : 'asc');
  };

  const Sortable = ({ k, label, width }: { k: ProductSortKey; label: string; width?: number }) => (
    <th
      onClick={() => onHeaderClick(k)}
      style={{ padding: '8px 12px', width, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      title={`Sort by ${label}`}
    >
      {label}
      <span style={{ marginLeft: 4, color: sortKey === k ? '#111' : 'transparent' }}>
        {sortDir === 'asc' ? '↑' : '↓'}
      </span>
    </th>
  );

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div
        className="admin-modal"
        onClick={e => e.stopPropagation()}
        // Wider, taller modal — admins are scanning hundreds of rows; we want
        // the picker to feel like a proper table view, not a sidebar drawer.
        style={{ width: 'min(1440px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16 }}>Add Products to “{catalog.name}”</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#666' }}>
              {tagged.size} already in this catalog · {products.length} in library · {filteredAndSorted.length} shown
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="admin-btn admin-btn-primary"
              onClick={onAutoPick}
              disabled={autoPicking || busy}
              title="Ask Claude to scan the library and tick products relevant to this catalog"
              style={{ fontSize: 12, padding: '6px 12px', whiteSpace: 'nowrap' }}
            >
              {autoPicking && autoProgress
                ? `✨ Scanning ${autoProgress.done}/${autoProgress.total}…`
                : '✨ Auto-pick relevant'}
            </button>
            <input
              type="text"
              placeholder="Search name, brand, type…"
              value={search}
              onChange={e => onSearch(e.target.value)}
              autoFocus
              style={{ flex: '0 1 280px', padding: '6px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 6 }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 0 }}>
          {filteredAndSorted.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#888', padding: 48, fontSize: 13 }}>
              No products match “{search}”.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: '#f8fafc' }}>
                <tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '8px 12px', width: 40 }}>
                    {(() => {
                      const selectable = filteredAndSorted.filter(p => !tagged.has(p.id));
                      const allSel = selectable.length > 0 && selectable.every(p => selected.has(p.id));
                      const someSel = !allSel && selectable.some(p => selected.has(p.id));
                      return (
                        <input
                          type="checkbox"
                          checked={allSel}
                          ref={el => { if (el) el.indeterminate = someSel; }}
                          onChange={() => selectable.forEach(p => {
                            if (allSel) { if (selected.has(p.id)) onToggle(p.id); }
                            else { if (!selected.has(p.id)) onToggle(p.id); }
                          })}
                          title="Select all"
                        />
                      );
                    })()}
                  </th>
                  <th style={{ padding: '8px 12px', width: 56 }}></th>
                  <Sortable k="name"    label="Product"        />
                  <Sortable k="brand"   label="Brand"   width={170} />
                  <Sortable k="type"    label="Type"    width={120} />
                  <Sortable k="gender"  label="Gender"  width={90}  />
                  <Sortable k="price"   label="Price"   width={90}  />
                  <Sortable k="video"   label="Video"   width={80}  />
                  <Sortable k="created" label="Added"   width={120} />
                  <th style={{ padding: '8px 12px', width: 90 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSorted.map(p => {
                  const isTagged = tagged.has(p.id);
                  const isSelected = selected.has(p.id);
                  const img = p.primary_image_url || p.image_url || '';
                  return (
                    <tr
                      key={p.id}
                      onClick={() => !isTagged && onToggle(p.id)}
                      style={{
                        borderTop: '1px solid #f1f5f9',
                        cursor: isTagged ? 'default' : 'pointer',
                        background: isSelected ? '#eff6ff' : isTagged ? '#f0fdf4' : '#fff',
                        opacity: isTagged ? 0.7 : 1,
                      }}
                    >
                      <td style={{ padding: '6px 12px' }} onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected || isTagged}
                          disabled={isTagged}
                          onChange={() => !isTagged && onToggle(p.id)}
                        />
                      </td>
                      <td style={{ padding: '6px 12px' }}>
                        {img ? (
                          // primary_image_url leads (the polished packshot
                          // vision picked); image_url is the scrape fallback
                          // so a freshly-added product without a polish run
                          // still has a thumbnail.
                          <img src={img} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 4, background: '#f1f5f9' }} />
                        ) : (
                          <div style={{ width: 44, height: 44, background: '#f1f5f9', borderRadius: 4 }} />
                        )}
                      </td>
                      <td style={{ padding: '6px 12px', fontWeight: 600, color: '#111' }}>{p.name || '—'}</td>
                      <td style={{ padding: '6px 12px', color: '#475569' }}>{p.brand || '—'}</td>
                      <td style={{ padding: '6px 12px', color: '#475569' }}>{p.type || '—'}</td>
                      <td style={{ padding: '6px 12px', color: '#475569', textTransform: 'capitalize' }}>{p.gender || '—'}</td>
                      <td style={{ padding: '6px 12px', color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>{p.price || '—'}</td>
                      <td style={{ padding: '6px 12px' }}>
                        {p.primary_video_url
                          ? <span title="Has primary video" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
                          : <span title="No primary video yet" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#e2e8f0' }} />
                        }
                      </td>
                      <td style={{ padding: '6px 12px', color: '#64748b', fontSize: 12 }}>
                        {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ padding: '6px 12px' }}>
                        {isTagged ? (
                          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#059669' }}>Added</span>
                        ) : isSelected ? (
                          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#2563eb' }}>Selected</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: '#666' }}>
            {selected.size} selected
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="admin-btn admin-btn-secondary"
              onClick={onClose}
              disabled={busy}
              style={{ fontSize: 12, padding: '6px 14px' }}
            >
              Cancel
            </button>
            <button
              className="admin-btn admin-btn-primary"
              onClick={onCommit}
              disabled={busy || selected.size === 0}
              style={{ fontSize: 12, padding: '6px 14px' }}
            >
              {busy ? 'Adding…' : `Add ${selected.size} product${selected.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface AddLooksModalProps {
  catalog: Catalog;
  looks: LookRow[];
  search: string;
  onSearch: (value: string) => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  busy: boolean;
  onClose: () => void;
  onCommit: () => void;
}

type LookSortKey = 'title' | 'creator' | 'video' | 'created';

function compareLooks(a: LookRow, b: LookRow, key: LookSortKey, dir: SortDir): number {
  const mul = dir === 'asc' ? 1 : -1;
  switch (key) {
    case 'title':   return ((a.title || '').toLowerCase()).localeCompare((b.title || '').toLowerCase()) * mul;
    case 'creator': return ((a.creatorHandle || '').toLowerCase()).localeCompare((b.creatorHandle || '').toLowerCase()) * mul;
    case 'video':   return (Number(Boolean(b.videoUrl ?? b.videoPath)) - Number(Boolean(a.videoUrl ?? a.videoPath))) * mul;
    case 'created': {
      const da = a.createdAt ? Date.parse(a.createdAt) : 0;
      const db = b.createdAt ? Date.parse(b.createdAt) : 0;
      return (db - da) * mul;
    }
  }
}

export function AddLooksModal({
  catalog,
  looks,
  search,
  onSearch,
  selected,
  onToggle,
  busy,
  onClose,
  onCommit,
}: AddLooksModalProps) {
  const [sortKey, setSortKey] = useState<LookSortKey>('created');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const tagged = useMemo(
    () => new Set(looks.filter(l => l.catalog_tags.includes(catalog.name)).map(l => l.id)),
    [looks, catalog.name],
  );
  const filteredAndSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = !q ? looks : looks.filter(l =>
      (l.title || '').toLowerCase().includes(q)
      || (l.creatorHandle || '').toLowerCase().includes(q),
    );
    return [...filtered].sort((a, b) => compareLooks(a, b, sortKey, sortDir));
  }, [looks, search, sortKey, sortDir]);

  const onHeaderClick = (key: LookSortKey) => {
    if (sortKey === key) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return; }
    setSortKey(key);
    setSortDir(key === 'created' || key === 'video' ? 'desc' : 'asc');
  };
  const Sortable = ({ k, label, width }: { k: LookSortKey; label: string; width?: number }) => (
    <th
      onClick={() => onHeaderClick(k)}
      style={{ padding: '8px 12px', width, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      title={`Sort by ${label}`}
    >
      {label}
      <span style={{ marginLeft: 4, color: sortKey === k ? '#111' : 'transparent' }}>
        {sortDir === 'asc' ? '↑' : '↓'}
      </span>
    </th>
  );

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div
        className="admin-modal"
        onClick={e => e.stopPropagation()}
        // Same wider/taller treatment as AddProductsModal so admins
        // scanning a catalog's library see the full row at a glance.
        style={{ width: 'min(1440px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16 }}>Add Looks to “{catalog.name}”</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#666' }}>
              {tagged.size} already in this catalog · {looks.length} live in library · {filteredAndSorted.length} shown
            </p>
          </div>
          <input
            type="text"
            placeholder="Search title or creator handle…"
            value={search}
            onChange={e => onSearch(e.target.value)}
            autoFocus
            style={{ flex: '0 1 280px', padding: '6px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 6 }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 0 }}>
          {filteredAndSorted.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#888', padding: 48, fontSize: 13 }}>
              {looks.length === 0 ? 'No live looks in the library.' : `No looks match “${search}”.`}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: '#f8fafc' }}>
                <tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '8px 12px', width: 40 }}>
                    {(() => {
                      const selectable = filteredAndSorted.filter(l => !tagged.has(l.id));
                      const allSel = selectable.length > 0 && selectable.every(l => selected.has(l.id));
                      const someSel = !allSel && selectable.some(l => selected.has(l.id));
                      return (
                        <input
                          type="checkbox"
                          checked={allSel}
                          ref={el => { if (el) el.indeterminate = someSel; }}
                          onChange={() => selectable.forEach(l => {
                            if (allSel) { if (selected.has(l.id)) onToggle(l.id); }
                            else { if (!selected.has(l.id)) onToggle(l.id); }
                          })}
                          title="Select all"
                        />
                      );
                    })()}
                  </th>
                  <th style={{ padding: '8px 12px', width: 56 }}></th>
                  <Sortable k="title"   label="Look"    />
                  <Sortable k="creator" label="Creator" width={200} />
                  <Sortable k="video"   label="Video"   width={80}  />
                  <Sortable k="created" label="Added"   width={120} />
                  <th style={{ padding: '8px 12px', width: 90 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSorted.map(l => {
                  const isTagged = tagged.has(l.id);
                  const isSelected = selected.has(l.id);
                  const src = (l.videoUrl || l.videoPath)
                    ? ((l.videoUrl || l.videoPath)!.startsWith('http')
                        ? (l.videoUrl || l.videoPath)!
                        : `${import.meta.env.BASE_URL}${(l.videoUrl || l.videoPath)!.replace(/^\//, '')}`)
                    : null;
                  return (
                    <tr
                      key={l.id}
                      onClick={() => !isTagged && onToggle(l.id)}
                      style={{
                        borderTop: '1px solid #f1f5f9',
                        cursor: isTagged ? 'default' : 'pointer',
                        background: isSelected ? '#eff6ff' : isTagged ? '#f0fdf4' : '#fff',
                        opacity: isTagged ? 0.7 : 1,
                      }}
                    >
                      <td style={{ padding: '6px 12px' }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected || isTagged} disabled={isTagged} onChange={() => !isTagged && onToggle(l.id)} />
                      </td>
                      <td style={{ padding: '6px 12px' }}>
                        {/* Larger video tile so admins can recognize a look
                            at a glance — was 30×40, now 36×48 in a 3:4 frame.
                            Poster fallback when no video URL resolved. */}
                        <div style={{ width: 36, height: 48, borderRadius: 4, overflow: 'hidden', background: '#000', position: 'relative' }}>
                          {src
                            ? <video src={src} muted playsInline preload="metadata" poster={l.thumbnailUrl ?? undefined} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : l.thumbnailUrl
                              ? <img src={l.thumbnailUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              : null}
                        </div>
                      </td>
                      <td style={{ padding: '6px 12px', fontWeight: 600, color: '#111' }}>{l.title || `Look #${l.legacyId ?? ''}`}</td>
                      <td style={{ padding: '6px 12px', color: '#475569' }}>{l.creatorHandle ? `@${l.creatorHandle}` : '—'}</td>
                      <td style={{ padding: '6px 12px' }}>
                        {(l.videoUrl || l.videoPath)
                          ? <span title="Has video" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
                          : <span title="No video" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#e2e8f0' }} />
                        }
                      </td>
                      <td style={{ padding: '6px 12px', color: '#64748b', fontSize: 12 }}>
                        {l.createdAt ? new Date(l.createdAt).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ padding: '6px 12px' }}>
                        {isTagged ? (
                          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#059669' }}>Added</span>
                        ) : isSelected ? (
                          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#2563eb' }}>Selected</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: '#666' }}>
            {selected.size} selected
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="admin-btn admin-btn-secondary"
              onClick={onClose}
              disabled={busy}
              style={{ fontSize: 12, padding: '6px 14px' }}
            >
              Cancel
            </button>
            <button
              className="admin-btn admin-btn-primary"
              onClick={onCommit}
              disabled={busy || selected.size === 0}
              style={{ fontSize: 12, padding: '6px 14px' }}
            >
              {busy ? 'Adding…' : `Add ${selected.size} look${selected.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Recommend Looks modal ─────────────────────────────────────────────
// Reviews Claude's catalog-recommend-looks output: a ranked list of
// existing library looks with a one-line reason each, pre-ticked so the
// admin can one-click attach the batch (catalog_tags write).
function RecommendLooksModal({
  catalog,
  looks,
  loading,
  error,
  results,
  selected,
  saving,
  onToggle,
  onClose,
  onCommit,
}: {
  catalog: Catalog;
  looks: LookRow[];
  loading: boolean;
  error: string | null;
  results: { id: string; reason: string }[];
  selected: Set<string>;
  saving: boolean;
  onToggle: (id: string) => void;
  onClose: () => void;
  onCommit: () => void;
}) {
  const byId = useMemo(() => new Map(looks.map(l => [l.id, l])), [looks]);
  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ width: 'min(720px, 96vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee' }}>
          <h2 style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>✨</span> Recommended looks for “{catalog.name}”
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#666' }}>
            Claude ranked the best-fitting looks from your library. Untick any you don’t want, then add.
          </p>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {loading && (
            <div style={{ textAlign: 'center', color: '#64748b', padding: 40, fontSize: 13 }}>
              ✨ Asking Claude to curate looks for “{catalog.name}”…
            </div>
          )}
          {!loading && error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: '#b91c1c', fontSize: 13 }}>
              {error}
            </div>
          )}
          {!loading && !error && results.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {results.map((r, i) => {
                const l = byId.get(r.id);
                const isSel = selected.has(r.id);
                const src = l?.videoPath
                  ? (l.videoPath.startsWith('http') ? l.videoPath : `${import.meta.env.BASE_URL}${l.videoPath.replace(/^\//, '')}`)
                  : null;
                return (
                  <div
                    key={r.id}
                    onClick={() => onToggle(r.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px',
                      border: `1px solid ${isSel ? '#2563eb' : '#e5e7eb'}`, borderRadius: 8,
                      background: isSel ? '#eff6ff' : '#fff', cursor: 'pointer',
                    }}
                  >
                    <input type="checkbox" checked={isSel} onChange={() => onToggle(r.id)} onClick={e => e.stopPropagation()} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', width: 18 }}>{i + 1}</span>
                    <div style={{ width: 34, height: 46, borderRadius: 4, overflow: 'hidden', background: '#000', flexShrink: 0 }}>
                      {src && <video src={src} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l?.title || `Look #${l?.legacyId ?? ''}`}
                      </div>
                      <div style={{ fontSize: 12, color: '#475569' }}>{r.reason}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: '#666' }}>{selected.size} selected</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="admin-btn admin-btn-secondary" onClick={onClose} disabled={saving} style={{ fontSize: 12, padding: '6px 14px' }}>
              Cancel
            </button>
            <button className="admin-btn admin-btn-primary" onClick={onCommit} disabled={saving || selected.size === 0} style={{ fontSize: 12, padding: '6px 14px' }}>
              {saving ? 'Adding…' : `Add ${selected.size} look${selected.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Featured checkbox cell ────────────────────────────────────────────
interface FeaturedToggleProps {
  slug: string | undefined;
  value: boolean | undefined;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  onError: (msg: string) => void;
}
function FeaturedToggle({ slug, value, disabled, onChange, onError }: FeaturedToggleProps) {
  const checked = value === true;
  const handle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (!slug) return;
    const next = e.target.checked;
    onChange(next);
    const ok = await setCatalogFeatured(slug, next);
    if (!ok) { onError('Could not save Featured state'); onChange(!next); }
  };
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled || !slug}
        onChange={handle}
        onClick={e => e.stopPropagation()}
        style={{ accentColor: '#2563eb', width: 16, height: 16, cursor: disabled ? 'not-allowed' : 'pointer' }}
      />
    </label>
  );
}

// ── Gender dropdown cell ──────────────────────────────────────────────
// Icon segmented-control for the catalog gender lens. Replaces the old
// <select> — four glyph buttons (Any / Female ♀ / Male ♂ / Unisex ⚥),
// the active one filled black. `onClick` stopPropagation so taps don't
// toggle the row's expand state.
// Compact dropdown for the catalog gender lens. The select chrome is
// pill-shaped + colours active when the value is anything but "Any",
// so the column reads at a glance which catalogs are gender-scoped.
function GenderDropdown({ value, onChange }: { value: CatalogGenderUI; onChange: (v: CatalogGenderUI) => void }) {
  const active = value !== 'all';
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as CatalogGenderUI)}
      onClick={e => e.stopPropagation()}
      title={`Gender: ${value === 'all' ? 'Any' : value === 'women' ? 'Female' : value === 'men' ? 'Male' : 'Unisex'}`}
      style={{
        padding: '4px 24px 4px 10px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        border: '1px solid',
        borderColor: active ? '#111' : '#e2e8f0',
        background: active ? '#111' : '#fff',
        color: active ? '#fff' : '#475569',
        cursor: 'pointer',
        appearance: 'none',
        backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='${active ? 'white' : '%2364748b'}' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 7px center',
        transition: 'all 0.1s',
      }}
    >
      <option value="all">⚪ Any</option>
      <option value="women">♀ Female</option>
      <option value="men">♂ Male</option>
      <option value="unisex">⚥ Unisex</option>
    </select>
  );
}

// ── Suggest Products modal (self-contained) ─────────────────────────
// Claude brainstorms product ideas for the catalog vibe, searches Google
// Shopping for each, and the admin picks which to ingest into `products`
// (auto-tagged with the catalog name). Owns all of its own state so it
// can be dropped into both the catalogs table and the detail page.
export function SuggestProductsModal({
  catalog,
  onClose,
  onIngested,
  showToast,
}: {
  catalog: Catalog;
  onClose: () => void;
  onIngested: () => void;
  showToast: (msg: string) => void;
}) {
  const [researchQuery, setResearchQuery] = useState(catalog.name);
  const [researchGender, setResearchGender] = useState<ProductGender | 'all'>('all');
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchResults, setResearchResults] = useState<BrainstormedProduct[]>([]);
  const [previewImg, setPreviewImg] = useState<{ url: string; x: number; y: number } | null>(null);
  const [researchSelected, setResearchSelected] = useState<Set<number>>(new Set());
  const [researchSource, setResearchSource] = useState<'live' | 'seed' | null>(null);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [brainstormPhase, setBrainstormPhase] = useState<'idle' | 'brainstorming' | 'searching' | 'done'>('idle');
  const [brainstormQueries, setBrainstormQueries] = useState<string[]>([]);
  const [brainstormProgress, setBrainstormProgress] = useState<{ done: number; total: number } | null>(null);

  const close = useCallback(() => { if (!ingesting) onClose(); }, [ingesting, onClose]);

  const runResearch = useCallback(async () => {
    if (!researchQuery.trim()) return;
    setResearchLoading(true);
    setResearchSelected(new Set());
    setResearchError(null);
    setResearchResults([]);
    setBrainstormQueries([]);
    setBrainstormPhase('brainstorming');
    setBrainstormProgress(null);

    const { queries, products, error, source } = await brainstormCatalogProducts(researchQuery, {
      count: 8,
      onProgress: (p) => {
        setBrainstormPhase(p.phase);
        if (p.queries) setBrainstormQueries(p.queries);
        if (p.completedQueries !== undefined && p.queries) {
          setBrainstormProgress({ done: p.completedQueries, total: p.queries.length });
        }
        if (p.products) setResearchResults(p.products);
      },
    });

    setBrainstormQueries(queries);
    setResearchResults(products);
    setResearchSource(source);
    setResearchError(error);
    setResearchLoading(false);
    setBrainstormPhase('done');
  }, [researchQuery]);

  const ingestSelectedProducts = useCallback(async () => {
    if (!supabase || researchSelected.size === 0) return;
    setIngesting(true);
    const nowIso = new Date().toISOString();
    const rows = Array.from(researchSelected).map(i => {
      const p = researchResults[i];
      return {
        name: p.name,
        brand: p.brand,
        price: p.price,
        url: p.url,
        image_url: p.image_url,
        images: p.image_urls || [p.image_url].filter(Boolean),
        scrape_status: 'done',
        scraped_at: nowIso,
        catalog_tags: [catalog.name],
      };
    });
    const { error } = await supabase.from('products').insert(rows).select('id');
    setIngesting(false);
    if (!error) {
      showToast(`Added ${rows.length} product${rows.length === 1 ? '' : 's'} from "${catalog.name}"`);
      onIngested();
      onClose();
    } else {
      showToast(`Ingest failed: ${error.message}`);
    }
  }, [researchSelected, researchResults, catalog.name, onIngested, onClose, showToast]);

  const visibleResearchResults = useMemo(() =>
    researchResults.filter(
      p => researchGender === 'all' || p.gender === researchGender || p.gender === 'unisex',
    ),
  [researchResults, researchGender]);

  return (
    <div className="admin-modal-overlay" onClick={close}>
      {previewImg && (
        <div
          style={{
            position: 'fixed',
            left: Math.min(previewImg.x, (typeof window !== 'undefined' ? window.innerWidth : 1600) - 280),
            top: Math.max(10, previewImg.y),
            width: 260,
            height: 340,
            borderRadius: 10,
            overflow: 'hidden',
            background: '#111',
            boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
            zIndex: 10000,
            pointerEvents: 'none',
          }}
        >
          <img
            src={previewImg.url}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}
      <div
        className="admin-modal"
        style={{ width: 720, maxWidth: '92vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '20px 24px 12px' }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>
            Suggest Products for "{catalog.name}"
          </h2>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: '#888' }}>
            Claude brainstorms specific product ideas for this vibe, then searches Google Shopping for each.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              autoFocus
              placeholder='e.g. "brunch outfit", "quiet luxury", "make me hot"'
              value={researchQuery}
              onChange={e => setResearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runResearch(); }}
              style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}
            />
            <button
              className="admin-btn admin-btn-primary"
              onClick={runResearch}
              disabled={researchLoading || !researchQuery.trim()}
            >
              {brainstormPhase === 'brainstorming'
                ? 'Brainstorming…'
                : brainstormPhase === 'searching' && brainstormProgress
                  ? `Searching ${brainstormProgress.done}/${brainstormProgress.total}…`
                  : researchLoading
                    ? 'Searching…'
                    : 'Suggest'}
            </button>
          </div>
          {brainstormQueries.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <span style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', alignSelf: 'center' }}>Claude searched:</span>
              {brainstormQueries.map((q, i) => (
                <span key={i} style={{
                  padding: '3px 10px',
                  borderRadius: 999,
                  background: '#f1f5f9',
                  border: '1px solid #e2e8f0',
                  fontSize: 11,
                  color: '#475569',
                  fontWeight: 500,
                }}>
                  {q}
                </span>
              ))}
            </div>
          )}
          {researchError && (
            <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12 }}>
              <strong>Search failed:</strong> {researchError}
            </div>
          )}
          {researchResults.length > 0 && researchSource && (
            <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 999, background: researchSource === 'live' ? '#ecfdf5' : '#fffbeb', border: '1px solid', borderColor: researchSource === 'live' ? '#a7f3d0' : '#fde68a', fontSize: 11, fontWeight: 600, color: researchSource === 'live' ? '#047857' : '#b45309', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: researchSource === 'live' ? '#10b981' : '#f59e0b' }} />
              {researchSource === 'live' ? 'Live Google Shopping' : 'Seed (offline)'}
            </div>
          )}
          {researchResults.length > 0 && (
            <div style={{ display: 'flex', gap: 12, marginTop: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{researchResults.length}</span>
                  <span style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Products</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#3b82f6' }}>
                    {researchResults.reduce((sum, p) => sum + (p.image_urls?.length || 1), 0)}
                  </span>
                  <span style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Thumbnails pulled</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>For</span>
                {(['all', 'men', 'women', 'unisex'] as const).map(g => (
                  <button
                    key={g}
                    onClick={() => setResearchGender(g)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 999,
                      border: '1px solid',
                      borderColor: researchGender === g ? '#111' : '#e2e8f0',
                      background: researchGender === g ? '#111' : '#fff',
                      color: researchGender === g ? '#fff' : '#111',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                    }}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '0 24px' }}>
          {researchLoading && researchResults.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: '#999', fontSize: 13 }}>
              {brainstormPhase === 'brainstorming'
                ? 'Asking Claude for product ideas…'
                : brainstormPhase === 'searching' && brainstormProgress
                  ? `Searching Google Shopping for each query (${brainstormProgress.done}/${brainstormProgress.total})…`
                  : 'Searching…'}
            </div>
          ) : researchResults.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: '#999', fontSize: 13 }}>
              Press Suggest to have Claude brainstorm products for this catalog.
            </div>
          ) : visibleResearchResults.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: '#999', fontSize: 13 }}>
              No results for that gender.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {visibleResearchResults.map(p => {
                const idx = researchResults.indexOf(p);
                const isSelected = researchSelected.has(idx);
                const scoreColor = p.thumbnailScore >= 85 ? '#16a34a' : p.thumbnailScore >= 70 ? '#ca8a04' : '#dc2626';
                const scoreLabel = p.thumbnailScore >= 90 ? 'Excellent' : p.thumbnailScore >= 75 ? 'Good' : p.thumbnailScore >= 60 ? 'Fair' : 'Poor';
                return (
                  <div
                    key={`${p.brand}-${p.name}-${idx}`}
                    onClick={() => {
                      setResearchSelected(prev => {
                        const next = new Set(prev);
                        if (next.has(idx)) next.delete(idx); else next.add(idx);
                        return next;
                      });
                    }}
                    onMouseEnter={e => {
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setPreviewImg({ url: p.image_url, x: r.right + 12, y: r.top });
                    }}
                    onMouseMove={e => {
                      setPreviewImg(prev => prev ? { ...prev, x: e.clientX + 16, y: e.clientY - 80 } : prev);
                    }}
                    onMouseLeave={() => setPreviewImg(null)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                      borderRadius: 8, cursor: 'pointer',
                      background: isSelected ? '#f0f7ff' : 'transparent',
                      border: `1px solid ${isSelected ? '#3b82f6' : '#eee'}`,
                    }}
                  >
                    <div style={{
                      width: 20, height: 20, borderRadius: 4,
                      border: `2px solid ${isSelected ? '#3b82f6' : '#ccc'}`,
                      background: isSelected ? '#3b82f6' : '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      {isSelected && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                      {(p.image_urls || [p.image_url]).slice(0, 4).map((u, ui) => (
                        <img
                          key={ui}
                          src={u}
                          alt=""
                          onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                          style={{
                            width: ui === 0 ? 48 : 28,
                            height: 48,
                            borderRadius: 6,
                            objectFit: 'cover',
                            background: '#f5f5f5',
                            border: '1px solid #e5e7eb',
                          }}
                        />
                      ))}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: '#888' }}>
                        {p.brand} · {p.price} · <span style={{ textTransform: 'capitalize' }}>{p.gender}</span>
                      </div>
                      {p.sourceQuery && (
                        <div style={{ fontSize: 10, color: '#64748b', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                          </svg>
                          <span>{p.sourceQuery}</span>
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: '#3b82f6', marginTop: 2, fontWeight: 600 }}>
                        {(p.image_urls || [p.image_url]).length} thumbnail{((p.image_urls || [p.image_url]).length === 1) ? '' : 's'} pulled
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 11, color: '#888' }}>Thumbnail</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: scoreColor }}>{p.thumbnailScore}</span>
                        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: `${scoreColor}18`, color: scoreColor, fontWeight: 600 }}>{scoreLabel}</span>
                      </div>
                      <div style={{ fontSize: 10, color: '#999' }}>{p.reason}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#888' }}>
            {researchSelected.size > 0 ? `${researchSelected.size} selected` : ''}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="admin-btn admin-btn-secondary" onClick={close} disabled={ingesting}>
              Cancel
            </button>
            <button
              className="admin-btn admin-btn-primary"
              onClick={ingestSelectedProducts}
              disabled={ingesting || researchSelected.size === 0}
            >
              {ingesting ? 'Adding…' : `Add ${researchSelected.size || ''} to Products`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Assemble Look modal (self-contained) ────────────────────────────
// Claude curates ~5 catalog-tagged products into a look concept + video
// prompt, then saves it as a pending look with a queued Veo render.
export function AssembleLookModal({
  catalog,
  products,
  onClose,
  onSaved,
  showToast,
}: {
  catalog: Catalog;
  products: ProductRow[];
  onClose: () => void;
  onSaved: () => void;
  showToast: (msg: string) => void;
}) {
  const [assembling, setAssembling] = useState(false);
  const [assembleResult, setAssembleResult] = useState<{
    title: string;
    description: string;
    style: string;
    prompt: string;
    productIds: string[];
  } | null>(null);
  const [savingLook, setSavingLook] = useState(false);
  const [assembleError, setAssembleError] = useState<string | null>(null);

  const runAssemble = useCallback(async () => {
    if (!supabase) return;
    const tagged = products.filter(p => (p.catalog_tags || []).includes(catalog.name));
    if (tagged.length < 3) {
      setAssembleError(`Not enough products tagged with "${catalog.name}" - need at least 3.`);
      return;
    }
    setAssembling(true);
    setAssembleError(null);
    setAssembleResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('catalog-assemble-look', {
        body: {
          catalog: catalog.name,
          products: tagged.map(p => ({
            id: p.id,
            name: p.name || '',
            brand: p.brand || '',
            image_url: p.image_url,
          })),
          count: 5,
        },
      });
      if (error) {
        setAssembleError(error.message);
      } else if (!data?.success) {
        setAssembleError(data?.error || 'Assembly failed');
      } else {
        setAssembleResult({
          title: data.title,
          description: data.description,
          style: data.style,
          prompt: data.prompt,
          productIds: data.productIds,
        });
      }
    } catch (err) {
      setAssembleError(err instanceof Error ? err.message : String(err));
    } finally {
      setAssembling(false);
    }
  }, [catalog.name, products]);

  const saveAssembledLook = useCallback(async () => {
    if (!assembleResult || !supabase) return;
    setSavingLook(true);
    try {
      const { data: lookRow, error: insertErr } = await supabase
        .from('looks')
        .insert({
          title: assembleResult.title,
          description: assembleResult.description,
          catalog_tags: [catalog.name],
          status: 'pending',
          enabled: false,
        })
        .select('id')
        .single();
      if (insertErr || !lookRow) {
        setAssembleError(insertErr?.message || 'Failed to save look');
        setSavingLook(false);
        return;
      }
      if (assembleResult.productIds.length > 0) {
        await supabase.from('look_products').insert(
          assembleResult.productIds.map((product_id, sort_order) => ({
            look_id: lookRow.id,
            product_id,
            sort_order,
          }))
        );
      }

      const heroProductId = assembleResult.productIds[0];
      if (heroProductId) {
        const styleSlug = assembleResult.style.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        await supabase.from('generated_videos').insert({
          product_id: heroProductId,
          look_id: lookRow.id,
          style: styleSlug || 'lifestyle_context',
          prompt: assembleResult.prompt,
          status: 'pending',
          aspect_ratio: '9:16',
        });
      }

      showToast(`Look "${assembleResult.title}" saved - video queued for generation`);
      onSaved();
      onClose();
    } catch (err) {
      setAssembleError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingLook(false);
    }
  }, [assembleResult, catalog.name, onSaved, onClose, showToast]);

  const taggedCount = products.filter(p => (p.catalog_tags || []).includes(catalog.name)).length;

  return (
    <div className="admin-modal-overlay" onClick={() => !assembling && !savingLook && onClose()}>
      <div
        className="admin-modal"
        style={{ width: 640, maxWidth: '92vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid #f0f0f0' }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>
            ✨ Assemble Look for "{catalog.name}"
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: '#888' }}>
            Claude picks 5 products tagged with this catalog and writes a look concept ready for video generation.
          </p>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          {!assembleResult && !assembling && !assembleError && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <button
                className="admin-btn admin-btn-primary"
                onClick={runAssemble}
              >
                Let Claude assemble this look
              </button>
              <div style={{ marginTop: 10, fontSize: 12, color: '#888' }}>
                {taggedCount} products tagged
              </div>
            </div>
          )}

          {assembling && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#888', fontSize: 13 }}>
              Assembling… Claude is curating the outfit and writing a video concept.
            </div>
          )}

          {assembleError && (
            <div style={{ padding: '10px 14px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12 }}>
              {assembleError}
            </div>
          )}

          {assembleResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Title</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#111' }}>{assembleResult.title}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Description</div>
                <div style={{ fontSize: 14, color: '#333' }}>{assembleResult.description}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Style</div>
                <span style={{ padding: '3px 10px', borderRadius: 999, background: '#eff6ff', color: '#1d4ed8', fontSize: 12, fontWeight: 600 }}>
                  {assembleResult.style}
                </span>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Products ({assembleResult.productIds.length})</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
                  {assembleResult.productIds.map(id => {
                    const p = products.find(x => x.id === id);
                    if (!p) return null;
                    return (
                      <div key={id} style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden', background: '#fff' }}>
                        {p.image_url && (
                          <img src={p.image_url} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
                        )}
                        <div style={{ padding: 6 }}>
                          <div style={{ fontSize: 10, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.brand}</div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Video Prompt</div>
                <div style={{ fontSize: 12, color: '#444', padding: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {assembleResult.prompt}
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {assembleResult && (
              <button
                className="admin-btn admin-btn-secondary"
                style={{ fontSize: 12 }}
                onClick={runAssemble}
                disabled={assembling || savingLook}
              >
                Try another
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="admin-btn admin-btn-secondary"
              onClick={onClose}
              disabled={assembling || savingLook}
            >
              Cancel
            </button>
            {assembleResult && (
              <button
                className="admin-btn admin-btn-primary"
                onClick={saveAssembledLook}
                disabled={savingLook}
              >
                {savingLook ? 'Saving…' : 'Save as look'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
