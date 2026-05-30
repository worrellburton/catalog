// Brand directory — aggregates the `products` table by brand for the
// /admin/brands view. There's no `brands` table today (brand lives as a
// text column on `products`), so every count here is computed from the
// products feed. The expanded-row detail loader pulls per-brand sample
// products + per-brand event totals on demand.

import { supabase } from '~/utils/supabase';

export interface BrandRow {
  /** The brand name as stored in products.brand (canonical case). */
  name: string;
  /** Total active products tagged with this brand. */
  productCount: number;
  /** How many of those products have a polished primary_image_url. */
  polishedCount: number;
  /** How many have a primary_video_url ready to serve in the feed. */
  withPrimaryVideoCount: number;
  /** Gender mix by product count. */
  menCount: number;
  womenCount: number;
  unisexCount: number;
  untaggedCount: number;
  /** Most recent products.updated_at for any product in this brand. */
  lastUpdatedAt: string | null;
  /** Whether brand_logos has a logo row for this brand (case-insensitive). */
  hasLogo: boolean;
  /** Sample product image so the table row paints even before the
   *  brand-logo lookup completes. */
  sampleImageUrl: string | null;
}

type ProductSlice = {
  brand: string | null;
  primary_image_polished: boolean | null;
  primary_video_url: string | null;
  gender: string | null;
  updated_at: string | null;
  image_url: string | null;
  primary_image_url: string | null;
};

/** One-shot loader: pulls every active product (only the columns the
 *  aggregator needs) and rolls them up by brand. */
export async function loadBrands(): Promise<BrandRow[]> {
  if (!supabase) return [];

  // Fetch a wide list with only the fields we need to keep the payload
  // small — at ~60 products today this is one round-trip; if the catalog
  // grows past ~10k we'll move this to a Postgres view.
  const { data: prodRows } = await supabase
    .from('products')
    .select('brand, primary_image_polished, primary_video_url, gender, updated_at, image_url, primary_image_url')
    .eq('is_active', true);

  const { data: logoRows } = await supabase
    .from('brand_logos')
    .select('name');

  const logoSet = new Set(((logoRows as { name: string }[] | null) ?? []).map(r => r.name.toLowerCase().trim()));

  const byBrand = new Map<string, BrandRow>();
  for (const raw of ((prodRows as ProductSlice[] | null) ?? [])) {
    const name = (raw.brand ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    let row = byBrand.get(key);
    if (!row) {
      row = {
        name,
        productCount: 0,
        polishedCount: 0,
        withPrimaryVideoCount: 0,
        menCount: 0,
        womenCount: 0,
        unisexCount: 0,
        untaggedCount: 0,
        lastUpdatedAt: null,
        hasLogo: logoSet.has(key),
        sampleImageUrl: raw.primary_image_url ?? raw.image_url ?? null,
      };
      byBrand.set(key, row);
    }
    row.productCount++;
    if (raw.primary_image_polished) row.polishedCount++;
    if (raw.primary_video_url) row.withPrimaryVideoCount++;
    const g = (raw.gender ?? '').toLowerCase();
    if (g === 'male' || g === 'men') row.menCount++;
    else if (g === 'female' || g === 'women') row.womenCount++;
    else if (g === 'unisex') row.unisexCount++;
    else row.untaggedCount++;
    if (raw.updated_at && (!row.lastUpdatedAt || raw.updated_at > row.lastUpdatedAt)) {
      row.lastUpdatedAt = raw.updated_at;
    }
    if (!row.sampleImageUrl && (raw.primary_image_url || raw.image_url)) {
      row.sampleImageUrl = raw.primary_image_url ?? raw.image_url;
    }
  }

  // Sort by product count desc, then name asc.
  return [...byBrand.values()].sort((a, b) =>
    b.productCount - a.productCount || a.name.localeCompare(b.name),
  );
}

// ── Brand detail (expanded row) ─────────────────────────────────────

export interface BrandSampleProduct {
  id: string;
  name: string | null;
  imageUrl: string | null;
  primaryImageUrl: string | null;
  primaryVideoUrl: string | null;
  price: string | null;
  gender: string | null;
  url: string | null;
}

export interface BrandEventTotals {
  impressions7d: number;
  clickouts7d: number;
}

export interface BrandDetail {
  products: BrandSampleProduct[];
  events: BrandEventTotals;
  /** Catalogs that include at least one product from this brand. */
  catalogs: string[];
}

/** Loader for the row-expansion drawer. Only called when the admin
 *  clicks a row, so the heavy joins stay off the initial page paint. */
export async function loadBrandDetail(brand: string): Promise<BrandDetail> {
  if (!supabase) return { products: [], events: { impressions7d: 0, clickouts7d: 0 }, catalogs: [] };

  // Products for this brand — case-insensitive match in case the table
  // has mixed casing for the same brand.
  const { data: prodRows } = await supabase
    .from('products')
    .select('id, name, image_url, primary_image_url, primary_video_url, price, gender, url, catalog_tags, updated_at')
    .ilike('brand', brand)
    .eq('is_active', true)
    .order('updated_at', { ascending: false });

  type ProdRow = {
    id: string;
    name: string | null;
    image_url: string | null;
    primary_image_url: string | null;
    primary_video_url: string | null;
    price: string | null;
    gender: string | null;
    url: string | null;
    catalog_tags: string[] | null;
    updated_at: string | null;
  };
  const prods = (prodRows as ProdRow[] | null) ?? [];

  const products: BrandSampleProduct[] = prods.map(p => ({
    id: p.id,
    name: p.name,
    imageUrl: p.image_url,
    primaryImageUrl: p.primary_image_url,
    primaryVideoUrl: p.primary_video_url,
    price: p.price,
    gender: p.gender,
    url: p.url,
  }));

  // Union of catalog_tags across the brand's products.
  const catalogSet = new Set<string>();
  for (const p of prods) {
    for (const t of (p.catalog_tags ?? [])) catalogSet.add(t);
  }

  // 7-day event totals via target_uuid. Empty when the brand has no
  // products in the cloud yet.
  const productIds = prods.map(p => p.id).filter(Boolean);
  let impressions7d = 0;
  let clickouts7d = 0;
  if (productIds.length > 0) {
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { count: impCount } = await supabase
      .from('user_events')
      .select('id', { count: 'exact', head: true })
      .in('target_uuid', productIds)
      .eq('event_type', 'impression')
      .gte('created_at', since);
    const { count: clkCount } = await supabase
      .from('user_events')
      .select('id', { count: 'exact', head: true })
      .in('target_uuid', productIds)
      .eq('event_type', 'clickout')
      .gte('created_at', since);
    impressions7d = impCount ?? 0;
    clickouts7d = clkCount ?? 0;
  }

  return {
    products,
    events: { impressions7d, clickouts7d },
    catalogs: [...catalogSet].sort(),
  };
}

// ── Display helpers ─────────────────────────────────────────────────

export function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '—';
  const diff = Date.now() - t;
  const day = 86400_000;
  if (diff < day) return 'today';
  if (diff < 2 * day) return 'yesterday';
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  if (diff < 30 * day) return `${Math.floor(diff / (7 * day))}w ago`;
  if (diff < 365 * day) return `${Math.floor(diff / (30 * day))}mo ago`;
  return `${Math.floor(diff / (365 * day))}y ago`;
}

export function pct(part: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}
