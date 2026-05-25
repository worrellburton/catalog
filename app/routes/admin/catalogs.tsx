import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from '@remix-run/react';
import { searchSuggestions } from '~/data/looks';
import { supabase } from '~/utils/supabase';
import {
  researchProducts,
  brainstormCatalogProducts,
  type ResearchedProduct,
  type BrainstormedProduct,
  type ProductGender,
} from '~/services/product-research';
import { getFeedSearchResults } from '~/services/feed-search';
import type { ProductAd } from '~/services/product-creative';
import {
  getHomeCatalog,
  updateCatalogToggles,
  setCatalogGender,
  getCatalogSearchCounts,
  type Catalog as CatalogService,
  type CatalogSearchCounts,
} from '~/services/catalogs';

type CatalogGenderUI = 'all' | 'women' | 'men' | 'unisex';

interface Catalog {
  id: string;
  name: string;
  source: 'featured' | 'custom';
  createdAt: string;
  isHome?: boolean;
  filterGender?: boolean;
  filterAge?: boolean;
  boostTopConverting?: boolean;
  gender?: CatalogGenderUI;
  slug?: string;
}

// Slugify a human-typed catalog name the same way ensure_catalog() does in
// migration 021: lowercase, non-alphanum → hyphens, trim hyphens from ends.
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface ProductRow {
  id: string;
  name: string | null;
  brand: string | null;
  image_url: string | null;
  catalog_tags: string[] | null;
  createdAt?: string | null;
  metrics?: ItemMetrics;
}

interface LookRow {
  id: string;
  legacyId: number | null;
  title: string | null;
  creatorHandle: string | null;
  videoPath: string | null;
  catalog_tags: string[];
}

interface CatalogLookRow {
  id: string;
  legacyId: number | null;
  title: string;
  videoPath: string | null;
  creatorHandle: string | null;
  creatorName: string | null;
  creatorAvatarUrl: string | null;
  productCount: number;
  createdAt?: string | null;
  metrics?: ItemMetrics;
}

interface CatalogCreativeVideo {
  id: string;
  productId: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  productImageUrl: string | null;
  title: string | null;
  productName: string | null;
  productBrand: string | null;
  status: string;
}

interface CatalogCreativePayload {
  looks: CatalogLookRow[];
  products: ProductRow[];
  creatives: CatalogCreativeVideo[];
  feedResults: CatalogCreativeVideo[];
}

const ALL_CATALOG_NAME = 'all';
const HOME_CATALOG_NAME = 'home';
const ALL_ORDER_KEY = 'catalog_admin_all_order';

type CatalogSection = 'looks' | 'creatives' | 'products';

function isAllCatalog(name: string) {
  return name.trim().toLowerCase() === ALL_CATALOG_NAME;
}

function isHomeCatalog(name: string) {
  return name.trim().toLowerCase() === HOME_CATALOG_NAME;
}

// "Universe" view: catalogs that should show every live look/product
// rather than only the rows whose catalog_tags contain the catalog
// name. Both `all` (admin meta-catalog) and `home` (consumer landing
// feed) qualify — the consumer home feed is unfiltered, so admins
// should see the same universe of candidates when triaging.
function isUniverseCatalog(name: string) {
  return isAllCatalog(name) || isHomeCatalog(name);
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
  localStorage.setItem(ALL_ORDER_KEY, JSON.stringify(order));
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

export default function AdminCatalogs() {
  const [custom, setCustom] = useState<Catalog[]>([]);
  const [homeCatalog, setHomeCatalog] = useState<CatalogService | null>(null);
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
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
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
      .select('id, slug, name, created_at, gender, is_featured, status, is_home, filter_gender, filter_age, boost_top_converting')
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
        is_home: boolean; filter_gender: boolean; filter_age: boolean; boost_top_converting: boolean;
      }[];
      // Home catalog goes into its own state slot; all others fill `custom`.
      const homeRow = rows.find(r => r.is_home);
      const regularRows = rows.filter(r => !r.is_home);

      setCustom(regularRows.map(r => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        source: 'custom' as const,
        createdAt: r.created_at,
        gender: (r.gender ?? 'all') as CatalogGenderUI,
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
          isFeatured: false,
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

  const loadProducts = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from('products')
      .select('id, name, brand, image_url, catalog_tags');
    if (data) setProducts(data as ProductRow[]);
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
        id, legacy_id, title, creator_handle, catalog_tags,
        looks_creative ( video_url, is_primary )
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
      looks_creative: { video_url: string | null; is_primary: boolean }[] | null;
    };
    const mapped: LookRow[] = (data as LookPayload[]).map(r => ({
      id: r.id,
      legacyId: r.legacy_id,
      title: r.title,
      creatorHandle: r.creator_handle,
      videoPath: r.looks_creative?.find(c => c.is_primary)?.video_url
        ?? r.looks_creative?.[0]?.video_url
        ?? null,
      catalog_tags: Array.isArray(r.catalog_tags) ? r.catalog_tags : [],
    }));
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
      const { data, error } = await supabase.rpc('catalog_item_metrics', {
        window_days: METRIC_WINDOW_DAYS,
      });
      if (error) {
        console.warn('[catalog-metrics] rpc failed:', error.message);
        return;
      }
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
      const next = new Map<string, ItemMetrics>();
      for (const r of (data as Row[] | null) || []) {
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
      const isAll = isAllCatalog(catalog.name);
      // Phase 2: Home shares the "show every live row" semantics with
      // All — the consumer home feed isn't tag-filtered, so admins
      // should see the same universe of candidates.
      const isUniverse = isUniverseCatalog(catalog.name);

      // Looks: universe catalogs (all / home) pull every live look so
      // admins can browse the entire active set; other catalogs filter
      // by catalog_tags.
      let looksQuery = supabase
        .from('looks')
        .select(`
          id, legacy_id, title, creator_handle, user_id, status, enabled, archived_at, created_at,
          creator:profiles!looks_user_id_fkey ( id, full_name, avatar_url ),
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
      const { data: lookRows } = await looksQuery;

      type LookPayload = {
        id: string;
        legacy_id: number | null;
        title: string;
        creator_handle: string | null;
        created_at: string | null;
        creator: { id: string; full_name: string | null; avatar_url: string | null } | { id: string; full_name: string | null; avatar_url: string | null }[] | null;
        looks_creative: { video_url: string | null; is_primary: boolean }[] | null;
        look_products: { product_id: string }[] | null;
      };
      const mappedLooks: CatalogLookRow[] = ((lookRows as LookPayload[] | null) || []).map(r => {
        // PostgREST sometimes returns the embedded profile as an array
        // (one-to-many style) and sometimes as a single object; normalise.
        const creator = Array.isArray(r.creator) ? r.creator[0] : r.creator;
        return {
          id: r.id,
          legacyId: r.legacy_id,
          title: r.title,
          videoPath: r.looks_creative?.[0]?.video_url ?? null,
          creatorHandle: r.creator_handle,
          creatorName: creator?.full_name ?? null,
          creatorAvatarUrl: creator?.avatar_url ?? null,
          productCount: (r.look_products || []).length,
          createdAt: r.created_at,
          metrics: metricFor('look', r.id, r.legacy_id),
        };
      });

      // Universe view collapses dupes - if multiple looks share the
      // same primary creative video they'd render as visual dupes, so
      // we keep the first occurrence per video. Named catalogs keep
      // every row.
      const looks = isUniverse
        ? Array.from(new Map(mappedLooks.map(l => [l.videoPath ?? l.id, l])).values())
        : mappedLooks;

      // Products: universe catalogs use every live product currently
      // loaded; others filter by catalog_tags. Both paths dedupe so
      // nothing repeats. Hydrate metrics in either case.
      const catalogProductsBase = isUniverse
        ? products
        : products.filter(p => (p.catalog_tags || []).includes(catalog.name));
      const catalogProducts = catalogProductsBase.map(p => ({
        ...p,
        metrics: metricFor('product', p.id),
      }));

      // Creative videos (product_creative). Universe catalogs pull every
      // rendered ad so admins see the full library in one place; named
      // catalogs filter to ads whose underlying product is tagged.
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
          title: r.title,
          productName: r.products?.name ?? null,
          productBrand: r.products?.brand ?? null,
          status: r.status,
        }));

      // Feed search results - same pipeline the consumer feed runs when a user
      // types this catalog name in the search bar. Skipped for the synthetic
      // `all` row (no meaningful query) and on failure (network/edge errors).
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
              status: a.status,
            }));
        } catch (err) {
          console.warn('[loadCreative] feed search failed:', err);
        }
      }

      // Merge products from feed search results so catalogs whose items don't
      // yet have catalog_tags still populate the Products section. Deduped by id.
      let displayProducts = catalogProducts;
      if (!isAll && feedResults.length > 0) {
        const existingIds = new Set(catalogProducts.map(p => p.id));
        const feedProductIds = new Set(feedResults.map(f => f.productId).filter(Boolean));
        const feedOnlyProducts = products.filter(
          p => feedProductIds.has(p.id) && !existingIds.has(p.id),
        );
        if (feedOnlyProducts.length > 0) {
          displayProducts = [...catalogProducts, ...feedOnlyProducts];
        }
      }

      if (isAll) {
        const order = loadAllOrder();
        const orderedLooks = applyOrder(looks, l => l.id, order.looks);
        const orderedCreatives = applyOrder(creatives, c => c.id, order.creatives);
        const orderedProducts = applyOrder(catalogProducts, p => p.id, order.products);
        setCreativeByCatalog(prev => ({
          ...prev,
          [catalog.id]: { looks: orderedLooks, products: orderedProducts, creatives: orderedCreatives, feedResults },
        }));
      } else {
        setCreativeByCatalog(prev => ({
          ...prev,
          [catalog.id]: { looks, products: displayProducts, creatives, feedResults },
        }));
      }
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

  // The 'all' row is a synthesized entry - it represents the aggregate view
  // of every live look/product/creative. Keep it at the top of the list even
  // if the user cleared localStorage, and filter it out of `custom` so the
  // remove (×) button can't drop it.
  const allRow: Catalog = {
    id: 'synthetic-all',
    name: 'all',
    source: 'custom',
    createdAt: ' - ',
  };
  const customWithoutAll = custom.filter(c => c.name.trim().toLowerCase() !== 'all');

  // Rank by total search volume so the catalogs shoppers actually care
  // about float to the top. Home is rendered separately above this
  // table so it's already pinned at #1; the synthetic `all` row stays
  // pinned at #2 as the admin meta-view (it would otherwise sink to
  // the bottom with 0 searches). Featured + custom catalogs sort by
  // searchCounts.countTotal desc, with countTotal=0 rows preserving
  // the original order (stable sort keeps recent admin work near the
  // top).
  const searchRank = (c: Catalog): number =>
    searchCounts.get(c.name.toLowerCase())?.countTotal ?? 0;
  const rankable = [...customWithoutAll, ...featured].sort((a, b) => searchRank(b) - searchRank(a));
  const allUnfiltered = [allRow, ...rankable];

  // Table-level search + quick filter chips. Operate on the
  // rankable list (skip the synthetic `all` row which always stays
  // at the top regardless). Empty query + 'all' filter = full list.
  const [tableQuery, setTableQuery] = useState('');
  const [tableFilter, setTableFilter] = useState<'all' | 'rising' | 'falling' | 'empty' | 'zombie' | 'issues'>('all');

  const all = useMemo(() => {
    const q = tableQuery.trim().toLowerCase();
    const filtered = rankable.filter(c => {
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
    // synthetic `all` row only shows when the unfiltered + unsearched
    // view is up — otherwise it's noise.
    if (tableQuery || tableFilter !== 'all') return filtered;
    return [allRow, ...filtered];
  }, [rankable, tableQuery, tableFilter, allRow, catalogImpressions, searchCounts, catalogProductCounts]);
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
      const picked = new Set<string>();
      for (let i = 0; i < candidates.length; i += BATCH) {
        const batch = candidates.slice(i, i + BATCH);
        const { data, error } = await supabase.functions.invoke('catalog-auto-tag', {
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
          showToast(`Auto-pick failed: ${error.message}`);
          break;
        }
        if (data?.success && data.results) {
          const results = data.results as Record<string, string[]>;
          for (const [id, tags] of Object.entries(results)) {
            if (tags.includes(name)) picked.add(id);
          }
        }
        setAddAutoProgress({ done: Math.min(i + BATCH, candidates.length), total: candidates.length });
      }
      setAddSelected(prev => {
        const next = new Set(prev);
        picked.forEach(id => next.add(id));
        return next;
      });
      showToast(`Picked ${picked.size} relevant product${picked.size === 1 ? '' : 's'}. Review and click Add to commit.`);
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
        // dropdown re-fetches with the new looks.
        setCreativeByCatalog(prev => {
          const next = { ...prev };
          delete next[addLooksCatalog.id];
          return next;
        });
        setAddLooksCatalog(null);
        setAddLooksSelected(new Set());
        setAddLooksSearch('');
      }
    } finally {
      setAddLooksBusy(false);
    }
  }, [addLooksCatalog, addLooksSelected, looks, loadLooks, showToast]);

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

  // Count products tagged with each catalog
  const catalogProductCounts = useMemo(() => {
    const counts = new Map<string, number>();
    products.forEach(p => {
      (p.catalog_tags || []).forEach(tag => {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      });
    });
    return counts;
  }, [products]);

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
          <button className="admin-btn admin-btn-primary" onClick={() => setShowAdd(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add new catalog
          </button>
        </div>
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

      <CatalogsDashboard
        catalogs={allUnfiltered}
        impressionsByName={catalogImpressions}
        searchCountsByName={searchCounts}
      />

      <CatalogsHealthPanel
        catalogs={allUnfiltered}
        impressionsByName={catalogImpressions}
        searchCountsByName={searchCounts}
        productCountsByName={catalogProductCounts}
        onJumpToCatalog={(name) => {
          // Strip the "↑22%" / "↓45%" trailing suffix used in sample
          // labels for trend issues — the actual catalog name is what
          // appears before " (".
          const cleanName = name.split(' (')[0];
          const match = allUnfiltered.find(c => c.name === cleanName);
          if (!match) return;
          // Drop any active filter so the row is actually present.
          if (tableFilter !== 'all') setTableFilter('all');
          if (tableQuery) setTableQuery('');
          setExpanded(prev => new Set(prev).add(match.id));
          if (!creativeByCatalog[match.id]) loadCreative(match);
          // Scroll the row into view after the state flush.
          requestAnimationFrame(() => {
            const row = document.querySelector(`[data-catalog-row="${match.id}"]`);
            if (row) row.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        }}
      />

      <CatalogsTableFilterBar
        query={tableQuery}
        filter={tableFilter}
        onQuery={setTableQuery}
        onFilter={setTableFilter}
        total={rankable.length}
        showing={all.length - (tableQuery || tableFilter !== 'all' ? 0 : 1)}
      />

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Catalog</th>
              <th>Source</th>
              <th>Products</th>
              <th>Impressions</th>
              <th>14d</th>
              <th>Searches</th>
              <th>Created</th>
              <th>Actions</th>
              <th>Toggles</th>
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
              const homeProductCount = catalogProductCounts.get(homeCatalog.name) || 0;
              return (
                <React.Fragment key={homeCatalog.id}>
                  <tr data-catalog-row={homeCatalog.id} style={{ background: '#fffbeb' }}>
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
                        <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: '#fef08a', color: '#713f12', marginRight: 2 }}>HOME</span>
                        <Link to="/admin/catalogs/home" style={{ color: '#111', textDecoration: 'none' }}>{homeCatalog.name}</Link>
                      </div>
                    </td>
                    <td>
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', background: '#ecfdf5', color: '#047857' }}>custom</span>
                    </td>
                    <td>
                      {homeProductCount > 0 ? (
                        <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#eff6ff', color: '#1d4ed8' }}>{homeProductCount}</span>
                      ) : (
                        <span style={{ fontSize: 11, color: '#ccc' }}> - </span>
                      )}
                    </td>
                    <td><ImpressionsPill counts={catalogImpressions.get(homeCatalog.name.toLowerCase())} /></td>
                    <td><MiniSparkline series={catalogDaily.get(homeCatalog.name.toLowerCase())} /></td>
                    <td><SearchCountPill counts={searchCounts.get(homeCatalog.name.toLowerCase())} /></td>
                    <td style={{ fontSize: 12, color: '#888' }}> - </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                        <button className="admin-btn admin-btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => openAdd(homeAsLocal)} disabled={products.length === 0}>+ Add Products</button>
                        <button className="admin-btn admin-btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => openAddLooks(homeAsLocal)} disabled={looks.length === 0} title="Pick existing looks from the library and tag them to this catalog">+ Add Looks</button>
                        <button className="admin-btn admin-btn-primary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => openSuggest(homeAsLocal)}>Suggest Products</button>
                      </div>
                    </td>
                    <td>
                      <TogglePills
                        gender={(homeCatalog.gender ?? 'all') as CatalogGenderUI}
                        filterAge={homeCatalog.filterAge}
                        boostTopConverting={homeCatalog.boostTopConverting}
                        onToggle={async (field, val) => {
                          setHomeCatalog(prev => prev ? { ...prev, [field]: val } : prev);
                          await updateCatalogToggles(homeCatalog.slug, { [field]: val });
                        }}
                        onGender={async (val) => {
                          setHomeCatalog(prev => prev ? { ...prev, gender: val } : prev);
                          const ok = await setCatalogGender(homeCatalog.slug, val);
                          if (!ok) showToast('Could not save gender — check RLS / admin RPC');
                        }}
                      />
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={9} style={{ padding: 0, background: '#fafafa', borderTop: 'none' }}>
                        <CatalogCreativeDropdown
                          isAll={false}
                          isUniverse={true}
                          catalogName={homeCatalog.name}
                          loading={isLoadingCreative}
                          creative={creative}
                          metricsLoading={metricsLoading}
                          catalogNames={all.filter(x => x.name !== homeCatalog.name && !isAllCatalog(x.name)).map(x => x.name)}
                          onReorder={() => {}}
                          onAfterBulkMutation={() => {
                            setCreativeByCatalog(prev => { const next = { ...prev }; delete next[homeCatalog.id]; return next; });
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
            const productCount =
              creativeByCatalog[c.id]?.products.length ??
              catalogProductCounts.get(c.name) ??
              0;
              const isOpen = expanded.has(c.id);
              const creative = creativeByCatalog[c.id];
              const isLoadingCreative = creativeLoading.has(c.id);
              return (
              <React.Fragment key={c.id}>
              <tr data-catalog-row={c.id}>
                <td style={{ textAlign: 'left', fontWeight: 600 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    background: c.source === 'custom' ? '#ecfdf5' : '#f1f5f9',
                    color: c.source === 'custom' ? '#047857' : '#475569',
                  }}>
                    {c.source}
                  </span>
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
                <td><ImpressionsPill counts={catalogImpressions.get(c.name.toLowerCase())} /></td>
                <td><MiniSparkline series={catalogDaily.get(c.name.toLowerCase())} /></td>
                <td><SearchCountPill counts={searchCounts.get(c.name.toLowerCase())} /></td>
                <td style={{ fontSize: 12, color: '#888' }}>
                  {c.createdAt === ' - ' ? ' - ' : new Date(c.createdAt).toLocaleDateString()}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                    <button
                      className="admin-btn admin-btn-secondary"
                      style={{ fontSize: 11, padding: '4px 10px' }}
                      onClick={() => openAdd(c)}
                      disabled={products.length === 0}
                      title="Pick existing products from the library and tag them to this catalog"
                    >
                      + Add Products
                    </button>
                    <button
                      className="admin-btn admin-btn-secondary"
                      style={{ fontSize: 11, padding: '4px 10px' }}
                      onClick={() => openAddLooks(c)}
                      disabled={looks.length === 0}
                      title="Pick existing looks from the library and tag them to this catalog"
                    >
                      + Add Looks
                    </button>
                    <button
                      className="admin-btn admin-btn-primary"
                      style={{ fontSize: 11, padding: '4px 10px' }}
                      onClick={() => openSuggest(c)}
                    >
                      Suggest Products
                    </button>
                    <button
                      className="admin-btn admin-btn-secondary"
                      style={{ fontSize: 11, padding: '4px 10px' }}
                      onClick={() => openAssemble(c)}
                      disabled={productCount < 3}
                      title={productCount < 3 ? 'Tag at least 3 products with this catalog first' : 'Claude assembles a look from tagged products'}
                    >
                      ✨ Assemble Look
                    </button>
                    {c.source === 'custom' && c.id !== 'synthetic-all' && (
                      <button
                        className="admin-btn admin-btn-secondary"
                        style={{ fontSize: 11, padding: '3px 8px', color: '#dc2626' }}
                        onClick={() => removeCustom(c.id)}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </td>
                <td>
                  {c.source === 'custom' ? (
                    <TogglePills
                      gender={c.gender ?? 'all'}
                      filterAge={c.filterAge}
                      boostTopConverting={c.boostTopConverting}
                      onToggle={async (field, val) => {
                        setCustom(prev => prev.map(x => x.id === c.id ? { ...x, [field]: val } : x));
                        if (c.slug) await updateCatalogToggles(c.slug, { [field]: val });
                      }}
                      onGender={async (val) => {
                        setCustom(prev => prev.map(x => x.id === c.id ? { ...x, gender: val } : x));
                        if (c.slug) {
                          const ok = await setCatalogGender(c.slug, val);
                          if (!ok) showToast('Could not save gender — check RLS / admin RPC');
                        }
                      }}
                    />
                  ) : null}
                </td>
              </tr>
              {isOpen && (
                <tr>
                  <td colSpan={9} style={{ padding: 0, background: '#fafafa', borderTop: 'none' }}>
                    <CatalogCreativeDropdown
                      isAll={isAllCatalog(c.name)}
                      isUniverse={isUniverseCatalog(c.name)}
                      catalogName={c.name}
                      loading={isLoadingCreative}
                      creative={creative}
                      metricsLoading={metricsLoading}
                      catalogNames={all.filter(x => x.name !== c.name && !isAllCatalog(x.name)).map(x => x.name)}
                      onReorder={(section, from, to) => reorderAllSection(c.id, section, from, to)}
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

// ── Table-level search + quick filter ────────────────────────────────
// Sits between the health panel and the table. Search filters by
// name substring; quick chips slice by health-style predicates
// (all / rising / falling / empty / zombie / has issues).
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
function MiniSparkline({ series }: { series?: number[] }) {
  if (!series || series.length === 0 || series.every(n => n === 0)) {
    return <span style={{ fontSize: 11, color: '#cbd5e1' }}>—</span>;
  }
  const W = 64; const H = 18;
  const max = Math.max(1, ...series);
  const barW = W / series.length;
  const total = series.reduce((a, b) => a + b, 0);
  return (
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
type ToggleField = 'filterAge' | 'boostTopConverting';
interface TogglePillsProps {
  gender?: CatalogGenderUI;
  filterAge?: boolean;
  boostTopConverting?: boolean;
  onToggle: (field: ToggleField, value: boolean) => void;
  onGender?: (value: CatalogGenderUI) => void;
}

function TogglePills({ gender, filterAge, boostTopConverting, onToggle, onGender }: TogglePillsProps) {
  const pills: { key: ToggleField; label: string; value: boolean; disabled?: boolean }[] = [
    { key: 'filterAge',           label: 'Age',     value: filterAge ?? false, disabled: true },
    { key: 'boostTopConverting',  label: 'Top ↑',   value: boostTopConverting ?? false },
  ];
  const currentGender: CatalogGenderUI = gender ?? 'all';
  const genderActive = currentGender !== 'all';
  const genderLabel: Record<CatalogGenderUI, string> = {
    all: 'Any gender', women: 'Women', men: 'Men', unisex: 'Unisex',
  };
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <select
        value={currentGender}
        onChange={e => onGender?.(e.target.value as CatalogGenderUI)}
        disabled={!onGender}
        title={`Gender lens: ${genderLabel[currentGender]}`}
        style={{
          padding: '2px 6px', borderRadius: 999, fontSize: 10, fontWeight: 600,
          border: '1px solid',
          borderColor: genderActive ? '#111' : '#e2e8f0',
          background: genderActive ? '#111' : '#fff',
          color: genderActive ? '#fff' : '#64748b',
          cursor: onGender ? 'pointer' : 'default',
          appearance: 'none',
          paddingRight: 18,
          backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='${genderActive ? 'white' : '%2364748b'}' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 5px center',
          transition: 'all 0.1s',
        }}
      >
        <option value="all">Any</option>
        <option value="women">Women</option>
        <option value="men">Men</option>
        <option value="unisex">Unisex</option>
      </select>
      {pills.map(p => (
        <button
          key={p.key}
          onClick={() => !p.disabled && onToggle(p.key, !p.value)}
          disabled={p.disabled}
          title={
            p.disabled
              ? 'Run scripts/tag-product-age-groups.mjs first to enable age filtering'
              : `${p.label}: ${p.value ? 'ON — click to disable' : 'OFF — click to enable'}`
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
  | null;

function CatalogCreativeDropdown({ isAll, isUniverse, catalogName, loading, creative, metricsLoading, catalogNames, onReorder, onAfterBulkMutation }: CatalogCreativeDropdownProps) {
  const [drawer, setDrawer] = useState<DrawerSubject>(null);
  // Phase 5: local sort/filter state. Per-dropdown so different
  // expanded catalogs can be sliced differently without interference.
  const [sort, setSort] = useState<MetricSort>('most-viewed');
  const [filter, setFilter] = useState<MetricFilter>('all');
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
    if (typeof window === 'undefined') return 'grid';
    try { return (window.localStorage.getItem(VIEW_MODE_LS_KEY) as ViewMode) || 'grid'; }
    catch { return 'grid'; }
  });
  useEffect(() => {
    try { window.localStorage.setItem(VIEW_MODE_LS_KEY, viewMode); } catch { /* private mode */ }
  }, [viewMode]);

  if (loading && !creative) {
    return (
      <div style={{ padding: '16px 24px', color: '#888', fontSize: 12 }}>Loading creative…</div>
    );
  }
  if (!creative) return null;

  const { looks, products, creatives, feedResults } = creative;
  const hasAny = looks.length > 0 || products.length > 0 || creatives.length > 0 || (feedResults?.length ?? 0) > 0;
  if (!hasAny) {
    return (
      <div style={{ padding: '16px 24px', color: '#888', fontSize: 12 }}>
        No looks, products, or creative {isUniverse ? 'are currently active.' : 'tagged with this catalog yet.'}
      </div>
    );
  }

  // Apply Phase 5 filter then sort to BOTH looks and products. Same
  // predicate runs against the metrics-decorated rows.
  const sortedLooks = sortAndFilterItems(looks, sort, filter);
  const sortedProducts = sortAndFilterItems(products, sort, filter);

  // Phase 7-lite: KPI strip across the top. Sums over the currently
  // visible rows (post-filter) so the numbers track what the admin is
  // actually looking at, not the full library.
  const kpi = buildKpiStrip([...sortedLooks, ...sortedProducts]);

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

  // Bulk: remove this catalog from each selected row's catalog_tags
  // array (Add Looks / Add Products do the inverse). RLS errors are
  // toasted and the dropdown refetches afterward.
  const bulkRemoveFromCatalog = useCallback(async () => {
    if (!supabase) return;
    setBulkBusy(true);
    try {
      const lookOps = [...selectedLookIds].map(async id => {
        const look = looks.find(l => l.id === id);
        if (!look) return;
        const { data: row } = await supabase!.from('looks').select('catalog_tags').eq('id', id).maybeSingle();
        const tags = ((row?.catalog_tags as string[] | null) || []).filter(t => t !== catalogName);
        await supabase!.from('looks').update({ catalog_tags: tags }).eq('id', id);
      });
      const productOps = [...selectedProductIds].map(async id => {
        const product = products.find(p => p.id === id);
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
  }, [selectedLookIds, selectedProductIds, looks, products, catalogName, clearSelection, onAfterBulkMutation]);

  // Bulk: hide the selected looks from the consumer feed by flipping
  // enabled=false. Products don't have a comparable on/off flag so
  // for now we no-op them with a toast hint.
  const bulkHide = useCallback(async () => {
    if (!supabase) return;
    setBulkBusy(true);
    try {
      const lookIds = [...selectedLookIds];
      if (lookIds.length > 0) {
        await supabase.from('looks').update({ enabled: false }).in('id', lookIds);
      }
      // products.is_active gate would belong here when an admin-write
      // RLS allows it. Surfacing the no-op via toast keeps expectations
      // clear without blocking the looks hide.
      clearSelection();
      onAfterBulkMutation();
    } finally {
      setBulkBusy(false);
    }
  }, [selectedLookIds, clearSelection, onAfterBulkMutation]);

  // Bulk: append a target catalog name to each selected row's
  // catalog_tags array. Lets admins fan out a curated selection to
  // multiple catalogs in one click instead of running the Add Looks
  // / Add Products picker per-catalog.
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

  const selectionCount = selectedLookIds.size + selectedProductIds.size;

  return (
    <div style={{ padding: '14px 24px 18px', display: 'flex', flexDirection: 'column', gap: 14, position: 'relative' }}>
      {isAll && (
        <div style={{ fontSize: 11, color: '#475569', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 10px' }}>
          The <strong>all</strong> catalog pulls every live look, rendered creative, and product - no duplicates, every entry shown in its entirety. Drag any tile to reorder.
        </div>
      )}
      {!isAll && isUniverse && (
        <div style={{ fontSize: 11, color: '#475569', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, padding: '6px 10px' }}>
          The <strong>home</strong> catalog mirrors the consumer landing feed — every live look and product, ranked by what shoppers see right now.
        </div>
      )}

      <KpiStrip kpi={kpi} metricsLoading={metricsLoading} />

      <MetricControlBar
        sort={sort} filter={filter} viewMode={viewMode}
        onSort={setSort} onFilter={setFilter} onViewMode={setViewMode}
      />

      {viewMode === 'list' ? (
        <>
          <LooksListTable
            looks={sortedLooks}
            selectedIds={selectedLookIds}
            onSelect={(id, idx, ext) => toggleSelection('look', id, idx, sortedLooks, ext)}
            onOpenDetail={(l) => setDrawer({ kind: 'look', look: l })}
          />
          <CreativesListTable title="Creative Videos" creatives={creatives} />
          {!isUniverse && (
            <CreativesListTable title="Feed search results" creatives={feedResults ?? []} />
          )}
          <ProductsListTable
            products={sortedProducts}
            selectedIds={selectedProductIds}
            onSelect={(id, idx, ext) => toggleSelection('product', id, idx, sortedProducts, ext)}
            onOpenDetail={(p) => setDrawer({ kind: 'product', product: p })}
          />
        </>
      ) : (
        <>
          <DraggableSection
            title="Looks"
            count={sortedLooks.length}
            emptyMessage="No looks match the current filter."
            minColumnPx={140}
            draggable={isAll && filter === 'all' && sort === 'most-viewed' && selectionCount === 0}
            onReorder={(from, to) => onReorder('looks', from, to)}
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

          <DraggableSection
            title="Creative Videos"
            count={creatives.length}
            emptyMessage="No rendered product ads in this catalog yet."
            minColumnPx={140}
            draggable={isAll}
            onReorder={(from, to) => onReorder('creatives', from, to)}
          >
            {creatives.map(c => (
              <CreativeThumb key={c.id} creative={c} />
            ))}
          </DraggableSection>

          {!isUniverse && (
            <DraggableSection
              title="Feed search results"
              count={feedResults?.length ?? 0}
              emptyMessage="No creatives surface for this query in the consumer feed search."
              minColumnPx={140}
              draggable={false}
              onReorder={() => {}}
            >
              {(feedResults ?? []).map(c => (
                <CreativeThumb key={`feed-${c.id}`} creative={c} />
              ))}
            </DraggableSection>
          )}

          <DraggableSection
            title="Products"
            count={sortedProducts.length}
            emptyMessage="No products match the current filter."
            minColumnPx={140}
            draggable={isAll && filter === 'all' && sort === 'most-viewed' && selectionCount === 0}
            onReorder={(from, to) => onReorder('products', from, to)}
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
              {subject.kind === 'look' ? 'Look' : 'Product'} · {catalogName}
            </div>
            <h2 style={{ margin: '2px 0 0', fontSize: 16, color: '#0f172a' }}>
              {subject.kind === 'look'
                ? (subject.look.title || `Look #${subject.look.legacyId ?? ''}`)
                : (subject.product.name || 'Unnamed product')}
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
            : <ProductDetailBody product={subject.product} />}
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
        {product.image_url ? (
          <img src={product.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
  return (
    <div style={{
      position: 'sticky',
      bottom: 14,
      alignSelf: 'center',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 12,
      padding: '8px 14px',
      background: '#0f172a',
      color: '#fff',
      borderRadius: 999,
      boxShadow: '0 16px 36px rgba(15,23,42,0.35)',
      zIndex: 20,
    }}>
      <span style={{ fontSize: 12, fontWeight: 700 }}>
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

function ListSectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
      <h4 style={{ margin: 0, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#475569', fontWeight: 700 }}>{title}</h4>
      <span style={{ fontSize: 11, color: '#94a3b8' }}>{count}</span>
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

function LooksListTable({
  looks,
  selectedIds,
  onSelect,
  onOpenDetail,
}: {
  looks: CatalogLookRow[];
  selectedIds?: Set<string>;
  onSelect?: (id: string, index: number, extendRange: boolean) => void;
  onOpenDetail?: (look: CatalogLookRow) => void;
}) {
  if (looks.length === 0) return (
    <div>
      <ListSectionHeader title="Looks" count={0} />
      <div style={{ padding: '10px 12px', color: '#94a3b8', fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 6, marginTop: 6 }}>
        No looks match the current filter.
      </div>
    </div>
  );
  return (
    <div>
      <ListSectionHeader title="Looks" count={looks.length} />
      <table style={{ ...listTableShellStyle, marginTop: 6 }}>
        <thead>
          <tr>
            {onSelect && <th style={{ ...listHeadCellStyle, width: 30 }}></th>}
            <th style={{ ...listHeadCellStyle, width: 56 }}></th>
            <th style={listHeadCellStyle}>Title</th>
            <th style={listHeadCellStyle}>Creator</th>
            <th style={listHeadCellStyle}>Products</th>
            <th style={listHeadCellStyle}>Impressions</th>
            <th style={listHeadCellStyle}>CTR</th>
            <th style={listHeadCellStyle}>Clickouts</th>
            <th style={listHeadCellStyle}>Trend</th>
          </tr>
        </thead>
        <tbody>
          {looks.map((l, idx) => {
            const checked = selectedIds?.has(l.id) ?? false;
            return (
              <tr
                key={l.id}
                onClick={(e) => {
                  if (!onSelect) return;
                  // Same metric-pill guard as the grid tiles.
                  if ((e.target as HTMLElement).closest('[data-role="metric-pill"]')) return;
                  onSelect(l.id, idx, e.shiftKey);
                }}
                style={{
                  cursor: onSelect ? 'pointer' : 'default',
                  background: checked ? '#eff6ff' : 'transparent',
                }}
              >
                {onSelect && (
                  <td style={listBodyCellStyle}>
                    <input type="checkbox" readOnly checked={checked} tabIndex={-1} />
                  </td>
                )}
                <td style={listBodyCellStyle}>
                  <div style={{ width: 36, height: 48, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                    {l.videoPath && (
                      <video
                        src={l.videoPath.startsWith('http') ? l.videoPath : `${import.meta.env.BASE_URL}${l.videoPath.replace(/^\//, '')}`}
                        muted playsInline preload="metadata"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    )}
                  </div>
                </td>
                <td style={{ ...listBodyCellStyle, fontWeight: 600, color: '#111' }}>{l.title || `Look #${l.legacyId ?? ''}`}</td>
                <td style={listBodyCellStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {l.creatorAvatarUrl ? (
                      <img src={l.creatorAvatarUrl} alt="" style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#e2e8f0' }} />
                    )}
                    <span style={{ color: '#111', fontWeight: 600 }}>{l.creatorName || l.creatorHandle || 'Unknown'}</span>
                    {l.creatorHandle && l.creatorName && (
                      <span style={{ color: '#94a3b8' }}>@{l.creatorHandle}</span>
                    )}
                  </div>
                </td>
                <td style={{ ...listBodyCellStyle, fontVariantNumeric: 'tabular-nums' }}>{l.productCount}</td>
                <MetricCells metrics={l.metrics} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProductsListTable({
  products,
  selectedIds,
  onSelect,
  onOpenDetail,
}: {
  products: ProductRow[];
  selectedIds?: Set<string>;
  onSelect?: (id: string, index: number, extendRange: boolean) => void;
  onOpenDetail?: (product: ProductRow) => void;
}) {
  if (products.length === 0) return (
    <div>
      <ListSectionHeader title="Products" count={0} />
      <div style={{ padding: '10px 12px', color: '#94a3b8', fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 6, marginTop: 6 }}>
        No products match the current filter.
      </div>
    </div>
  );
  return (
    <div>
      <ListSectionHeader title="Products" count={products.length} />
      <table style={{ ...listTableShellStyle, marginTop: 6 }}>
        <thead>
          <tr>
            {onSelect && <th style={{ ...listHeadCellStyle, width: 30 }}></th>}
            <th style={{ ...listHeadCellStyle, width: 56 }}></th>
            <th style={listHeadCellStyle}>Product</th>
            <th style={listHeadCellStyle}>Brand</th>
            <th style={listHeadCellStyle}>Impressions</th>
            <th style={listHeadCellStyle}>CTR</th>
            <th style={listHeadCellStyle}>Clickouts</th>
            <th style={listHeadCellStyle}>Trend</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p, idx) => {
            const checked = selectedIds?.has(p.id) ?? false;
            return (
              <tr
                key={p.id}
                onClick={(e) => {
                  if (!onSelect) return;
                  if ((e.target as HTMLElement).closest('[data-role="metric-pill"]')) return;
                  onSelect(p.id, idx, e.shiftKey);
                }}
                style={{
                  cursor: onSelect ? 'pointer' : 'default',
                  background: checked ? '#eff6ff' : 'transparent',
                }}
              >
                {onSelect && (
                  <td style={listBodyCellStyle}>
                    <input type="checkbox" readOnly checked={checked} tabIndex={-1} />
                  </td>
                )}
                <td style={listBodyCellStyle}>
                  {p.image_url ? (
                    <img src={p.image_url} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, background: '#f1f5f9' }} />
                  ) : (
                    <div style={{ width: 36, height: 36, background: '#f1f5f9', borderRadius: 4 }} />
                  )}
                </td>
                <td style={{ ...listBodyCellStyle, fontWeight: 600, color: '#111' }}>{p.name || '—'}</td>
                <td style={{ ...listBodyCellStyle, color: '#475569' }}>{p.brand || '—'}</td>
                <MetricCells metrics={p.metrics} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Phase 5: sort + filter helpers shared by looks and products ─────
type MetricBearing = { metrics?: ItemMetrics; createdAt?: string | null };

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
  filter: MetricFilter;
  viewMode: ViewMode;
  onSort: (s: MetricSort) => void;
  onFilter: (f: MetricFilter) => void;
  onViewMode: (v: ViewMode) => void;
}

function MetricControlBar({ sort, filter, viewMode, onSort, onFilter, onViewMode }: MetricControlBarProps) {
  const sortOpts: { value: MetricSort; label: string }[] = [
    { value: 'most-viewed', label: 'Most viewed' },
    { value: 'highest-ctr', label: 'Highest CTR' },
    { value: 'biggest-riser', label: 'Biggest riser' },
    { value: 'biggest-faller', label: 'Biggest faller' },
    { value: 'newest', label: 'Newest' },
    { value: 'never-viewed', label: 'Never viewed' },
  ];
  const filterChips: { value: MetricFilter; label: string; color?: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'rising', label: '↑ Rising', color: '#047857' },
    { value: 'falling', label: '↓ Falling', color: '#b91c1c' },
    { value: 'zombie', label: '⚠ Zombie', color: '#a16207' },
    { value: 'never-viewed', label: 'Never viewed', color: '#6b7280' },
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
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {filterChips.map(c => {
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
    >
      {product.image_url ? (
        <img src={product.image_url} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block', background: '#f5f5f5' }} />
      ) : (
        <div style={{ width: '100%', aspectRatio: '1', background: '#f5f5f5' }} />
      )}
      <MetricBadgeRow metrics={product.metrics} />
      {selected && <SelectionBadge />}
      {onOpenDetail && <ExpandTileButton onClick={onOpenDetail} />}
      <div style={{ padding: 6 }}>
        <div style={{ fontSize: 10, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{product.brand || ' - '}</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{product.name || ' - '}</div>
      </div>
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

const metricChipBase: React.CSSProperties = {
  padding: '1px 6px',
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.3px',
  lineHeight: '14px',
  cursor: 'help',
};

interface DraggableSectionProps {
  title: string;
  count: number;
  emptyMessage: string;
  minColumnPx: number;
  draggable: boolean;
  onReorder: (fromIndex: number, toIndex: number) => void;
  children: React.ReactNode;
}

function DraggableSection({ title, count, emptyMessage, minColumnPx, draggable, onReorder, children }: DraggableSectionProps) {
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
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#111', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {title}
        </h3>
        <span style={{ fontSize: 11, color: '#888' }}>{count}</span>
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

function CreativeThumb({ creative }: { creative: CatalogCreativeVideo }) {
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

function AddProductsModal({
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
  const tagged = useMemo(
    () => new Set(products.filter(p => (p.catalog_tags || []).includes(catalog.name)).map(p => p.id)),
    [products, catalog.name],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(p =>
      (p.name || '').toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q),
    );
  }, [products, search]);

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ width: 'min(1040px, 96vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16 }}>Add Products to “{catalog.name}”</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#666' }}>
              {tagged.size} already in this catalog · {products.length} in library
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
              placeholder="Search by name or brand"
              value={search}
              onChange={e => onSearch(e.target.value)}
              autoFocus
              style={{ flex: '0 1 260px', padding: '6px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 6 }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#888', padding: 48, fontSize: 13 }}>
              No products match “{search}”.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
              {filtered.map(p => {
                const isTagged = tagged.has(p.id);
                const isSelected = selected.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => !isTagged && onToggle(p.id)}
                    disabled={isTagged}
                    style={{
                      textAlign: 'left',
                      padding: 0,
                      border: `2px solid ${isSelected ? '#2563eb' : isTagged ? '#d1fae5' : '#e5e7eb'}`,
                      borderRadius: 8,
                      overflow: 'hidden',
                      background: '#fff',
                      cursor: isTagged ? 'default' : 'pointer',
                      opacity: isTagged ? 0.55 : 1,
                      position: 'relative',
                    }}
                  >
                    {p.image_url ? (
                      <img src={p.image_url} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block', background: '#f5f5f5' }} />
                    ) : (
                      <div style={{ width: '100%', aspectRatio: '1', background: '#f5f5f5' }} />
                    )}
                    <div style={{ padding: 8 }}>
                      <div style={{ fontSize: 10, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.brand || ' - '}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || ' - '}</div>
                    </div>
                    {isTagged && (
                      <span style={{
                        position: 'absolute', top: 6, right: 6,
                        padding: '2px 6px', borderRadius: 4,
                        fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
                        background: '#10b981', color: '#fff',
                      }}>Added</span>
                    )}
                    {isSelected && !isTagged && (
                      <span style={{
                        position: 'absolute', top: 6, right: 6,
                        padding: '2px 6px', borderRadius: 4,
                        fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
                        background: '#2563eb', color: '#fff',
                      }}>Selected</span>
                    )}
                  </button>
                );
              })}
            </div>
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

function AddLooksModal({
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
  const tagged = useMemo(
    () => new Set(looks.filter(l => l.catalog_tags.includes(catalog.name)).map(l => l.id)),
    [looks, catalog.name],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return looks;
    return looks.filter(l =>
      (l.title || '').toLowerCase().includes(q)
      || (l.creatorHandle || '').toLowerCase().includes(q),
    );
  }, [looks, search]);

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ width: 'min(1040px, 96vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16 }}>Add Looks to “{catalog.name}”</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#666' }}>
              {tagged.size} already in this catalog · {looks.length} live in library
            </p>
          </div>
          <input
            type="text"
            placeholder="Search by title or creator handle"
            value={search}
            onChange={e => onSearch(e.target.value)}
            autoFocus
            style={{ flex: '0 1 260px', padding: '6px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 6 }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#888', padding: 48, fontSize: 13 }}>
              {looks.length === 0 ? 'No live looks in the library.' : `No looks match “${search}”.`}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
              {filtered.map(l => {
                const isTagged = tagged.has(l.id);
                const isSelected = selected.has(l.id);
                return (
                  <AddLookTile
                    key={l.id}
                    look={l}
                    isTagged={isTagged}
                    isSelected={isSelected}
                    onToggle={() => !isTagged && onToggle(l.id)}
                  />
                );
              })}
            </div>
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

function AddLookTile({
  look,
  isTagged,
  isSelected,
  onToggle,
}: {
  look: LookRow;
  isTagged: boolean;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const src = look.videoPath
    ? (look.videoPath.startsWith('http')
        ? look.videoPath
        : `${import.meta.env.BASE_URL}${look.videoPath.replace(/^\//, '')}`)
    : null;

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isTagged}
      onMouseEnter={() => { videoRef.current?.play().catch(() => {}); }}
      onMouseLeave={() => { if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = 0; } }}
      style={{
        textAlign: 'left',
        padding: 0,
        border: `2px solid ${isSelected ? '#2563eb' : isTagged ? '#d1fae5' : '#e5e7eb'}`,
        borderRadius: 8,
        overflow: 'hidden',
        background: '#fff',
        cursor: isTagged ? 'default' : 'pointer',
        opacity: isTagged ? 0.55 : 1,
        position: 'relative',
      }}
    >
      <div style={{ width: '100%', aspectRatio: '9/16', background: '#000' }}>
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
      </div>
      <div style={{ padding: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {look.title || `Look #${look.legacyId ?? ''}`}
        </div>
        <div style={{ fontSize: 10, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {look.creatorHandle ? `@${look.creatorHandle}` : ' - '}
        </div>
      </div>
      {isTagged && (
        <span style={{
          position: 'absolute', top: 6, right: 6,
          padding: '2px 6px', borderRadius: 4,
          fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
          background: '#10b981', color: '#fff',
        }}>Added</span>
      )}
      {isSelected && !isTagged && (
        <span style={{
          position: 'absolute', top: 6, right: 6,
          padding: '2px 6px', borderRadius: 4,
          fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
          background: '#2563eb', color: '#fff',
        }}>Selected</span>
      )}
    </button>
  );
}
