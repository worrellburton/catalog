import { supabase } from '~/utils/supabase';

export type CatalogGender = 'all' | 'men' | 'women' | 'unisex';
export const CATALOG_GENDERS: CatalogGender[] = ['all', 'women', 'men', 'unisex'];

export interface Catalog {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  themePrompt: string | null;
  gender: CatalogGender;
  coverUrl: string | null;
  sortOrder: number;
  isFeatured: boolean;
  status: 'draft' | 'live' | 'archived';
  isHome: boolean;
  filterGender: boolean;
  filterAge: boolean;
  boostTopConverting: boolean;
}

interface CatalogRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  theme_prompt: string | null;
  gender: CatalogGender;
  cover_url: string | null;
  sort_order: number;
  is_featured: boolean;
  status: 'draft' | 'live' | 'archived';
  is_home: boolean;
  filter_gender: boolean;
  filter_age: boolean;
  boost_top_converting: boolean;
}

const CATALOG_SELECT = 'id, slug, name, description, theme_prompt, gender, cover_url, sort_order, is_featured, status, is_home, filter_gender, filter_age, boost_top_converting';

function fromRow(row: CatalogRow): Catalog {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    themePrompt: row.theme_prompt,
    gender: row.gender,
    coverUrl: row.cover_url,
    sortOrder: row.sort_order,
    isFeatured: row.is_featured,
    status: row.status,
    isHome: row.is_home ?? false,
    filterGender: row.filter_gender ?? false,
    filterAge: row.filter_age ?? false,
    boostTopConverting: row.boost_top_converting ?? false,
  };
}

export async function getLiveCatalogs(): Promise<Catalog[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('catalogs')
    .select(CATALOG_SELECT)
    .eq('status', 'live')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error || !data) {
    console.warn('getLiveCatalogs failed:', error?.message);
    return [];
  }
  return (data as CatalogRow[]).map(fromRow);
}

export async function getCatalogBySlug(slug: string): Promise<Catalog | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('catalogs')
    .select(CATALOG_SELECT)
    .eq('slug', slug)
    .maybeSingle();
  if (error || !data) return null;
  return fromRow(data as CatalogRow);
}

export async function upsertCatalog(input: {
  slug: string;
  name: string;
  description?: string | null;
  themePrompt?: string | null;
  gender?: 'all' | 'men' | 'women';
  coverUrl?: string | null;
  sortOrder?: number;
  isFeatured?: boolean;
  status?: 'draft' | 'live' | 'archived';
}): Promise<Catalog | null> {
  if (!supabase) return null;
  const payload = {
    slug: input.slug,
    name: input.name,
    description: input.description ?? null,
    theme_prompt: input.themePrompt ?? null,
    gender: input.gender ?? 'all',
    cover_url: input.coverUrl ?? null,
    sort_order: input.sortOrder ?? 0,
    is_featured: input.isFeatured ?? false,
    status: input.status ?? 'live',
  };
  const { data, error } = await supabase
    .from('catalogs')
    .upsert(payload, { onConflict: 'slug' })
    .select(CATALOG_SELECT)
    .single();
  if (error || !data) {
    console.error('upsertCatalog failed:', error?.message);
    return null;
  }
  return fromRow(data as CatalogRow);
}

export async function deleteCatalogBySlug(slug: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('catalogs').delete().eq('slug', slug);
  if (error) {
    console.error('deleteCatalogBySlug failed:', error.message);
    return false;
  }
  return true;
}

// ============================================
// Catalog ↔ Product junction
// ============================================

export interface CatalogProductRef {
  productId: string;
  catalogId: string;
  sortOrder: number;
  matchScore: number | null;
  source: 'manual' | 'auto' | 'imported';
}

export interface CatalogProductDetail extends CatalogProductRef {
  name: string;
  brand: string;
  price: string | null;
  url: string | null;
  imageUrl: string | null;
}

export async function getCatalogProducts(catalogId: string): Promise<CatalogProductDetail[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('catalog_products')
    .select(`
      catalog_id, product_id, sort_order, match_score, source,
      products ( name, brand, price, url, image_url )
    `)
    .eq('catalog_id', catalogId)
    .order('sort_order', { ascending: true });
  if (error || !data) {
    console.warn('getCatalogProducts failed:', error?.message);
    return [];
  }
  return data.map((row) => {
    const r = row as unknown as {
      catalog_id: string;
      product_id: string;
      sort_order: number;
      match_score: number | null;
      source: 'manual' | 'auto' | 'imported';
      products: { name: string; brand: string; price: string | null; url: string | null; image_url: string | null } | null;
    };
    return {
      catalogId: r.catalog_id,
      productId: r.product_id,
      sortOrder: r.sort_order,
      matchScore: r.match_score,
      source: r.source,
      name: r.products?.name ?? '',
      brand: r.products?.brand ?? '',
      price: r.products?.price ?? null,
      url: r.products?.url ?? null,
      imageUrl: r.products?.image_url ?? null,
    };
  });
}

export async function setCatalogProducts(
  catalogId: string,
  entries: { productId: string; sortOrder?: number; matchScore?: number | null; source?: 'manual' | 'auto' | 'imported' }[],
  options: { replace?: boolean } = {}
): Promise<{ inserted: number }> {
  if (!supabase) return { inserted: 0 };
  if (options.replace) {
    const { error: delErr } = await supabase.from('catalog_products').delete().eq('catalog_id', catalogId);
    if (delErr) {
      console.error('setCatalogProducts replace delete failed:', delErr.message);
      return { inserted: 0 };
    }
  }
  if (entries.length === 0) return { inserted: 0 };
  const rows = entries.map((e, i) => ({
    catalog_id: catalogId,
    product_id: e.productId,
    sort_order: e.sortOrder ?? (i + 1) * 10,
    match_score: e.matchScore ?? null,
    source: e.source ?? 'manual',
  }));
  const { data, error } = await supabase
    .from('catalog_products')
    .upsert(rows, { onConflict: 'catalog_id,product_id' })
    .select('product_id');
  if (error) {
    console.error('setCatalogProducts upsert failed:', error.message);
    return { inserted: 0 };
  }
  return { inserted: data?.length ?? 0 };
}

export interface AutoAssignResult {
  inserted: number;
  totalCandidates: number;
  topScore: number;
}

export interface AutoAssignLookResult {
  looksTouched: number;
  productsInserted: number;
}

export async function autoAssignLookProducts(
  catalogId: string,
  options: { perLook?: number } = {}
): Promise<AutoAssignLookResult> {
  if (!supabase) return { looksTouched: 0, productsInserted: 0 };
  const { data, error } = await supabase.rpc('catalog_auto_assign_look_products', {
    p_catalog_id: catalogId,
    p_per_look: options.perLook ?? 5,
  });
  if (error || !data) {
    console.error('autoAssignLookProducts failed:', error?.message);
    return { looksTouched: 0, productsInserted: 0 };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    looksTouched: row?.looks_touched ?? 0,
    productsInserted: row?.products_inserted ?? 0,
  };
}

export async function autoAssignCatalogProducts(
  catalogId: string,
  options: { limit?: number; minScore?: number } = {}
): Promise<AutoAssignResult> {
  if (!supabase) return { inserted: 0, totalCandidates: 0, topScore: 0 };
  const { data, error } = await supabase.rpc('catalog_auto_assign_products', {
    p_catalog_id: catalogId,
    p_limit: options.limit ?? 24,
    p_min_score: options.minScore ?? 0.05,
  });
  if (error || !data) {
    console.error('autoAssignCatalogProducts failed:', error?.message);
    return { inserted: 0, totalCandidates: 0, topScore: 0 };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    inserted: row?.inserted ?? 0,
    totalCandidates: row?.total_candidates ?? 0,
    topScore: row?.top_score ?? 0,
  };
}

export interface ProductCatalog {
  name: string;
  slug: string;
  matchScore: number | null;
}

/**
 * Catalogs a product is "Popular in" — the live, non-home catalogs whose theme
 * it auto-matched (plus any manual pins), strongest first. Matched by name
 * (+ optional brand) via the get_product_catalogs RPC so the caller needn't
 * carry a product id. Reads the same catalog_products membership the catalog
 * feed uses, so tapping a result always lands in a feed that contains this
 * product. Returns [] on any failure (the section just hides).
 */
export async function getProductCatalogs(name: string, brand?: string | null): Promise<ProductCatalog[]> {
  if (!supabase || !name || !name.trim()) return [];
  const { data, error } = await supabase.rpc('get_product_catalogs', {
    p_name: name,
    p_brand: brand ?? null,
  });
  if (error || !data) {
    if (error) console.warn('getProductCatalogs failed:', error.message);
    return [];
  }
  return (data as { name: string; slug: string; match_score: number | null }[]).map(r => ({
    name: r.name,
    slug: r.slug,
    matchScore: r.match_score,
  }));
}

export async function removeCatalogProduct(catalogId: string, productId: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase
    .from('catalog_products')
    .delete()
    .eq('catalog_id', catalogId)
    .eq('product_id', productId);
  if (error) {
    console.error('removeCatalogProduct failed:', error.message);
    return false;
  }
  return true;
}

// ============================================
// Catalog toggles + signals
// ============================================

export async function getHomeCatalog(): Promise<Catalog | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('catalogs')
    .select(CATALOG_SELECT)
    .eq('is_home', true)
    .maybeSingle();
  if (error || !data) return null;
  return fromRow(data as CatalogRow);
}

// Sets the catalogs.gender enum (all / women / men / unisex) directly.
// Uses a thin admin RPC because the catalogs table has no broad
// UPDATE RLS for the anon admin client — same constraint that drove
// admin_update_catalog_toggles. Returns false on RPC failure so the
// caller can toast.
// Bulk-update catalogs.sort_order by passing an ordered list of
// slugs. The RPC writes sort_order = index for each, so the order
// the slugs arrive in IS the persisted order. Used by the drag-
// reorder UX in /admin/catalogs.
// Re-export for the admin/catalogs route which imports its types
// directly from this module.

export async function setCatalogSortOrder(slugs: string[]): Promise<boolean> {
  if (!supabase || slugs.length === 0) return false;
  const { error } = await supabase.rpc('admin_set_catalog_sort_order', { p_slugs: slugs });
  if (error) {
    console.error('setCatalogSortOrder failed:', error.message);
    return false;
  }
  return true;
}

// Toggle catalogs.is_featured via admin RPC. Featured catalogs are
// the ones the consumer suggestor surfaces; non-featured ("custom")
// stay admin-only. Same admin-gated RPC shape as setCatalogGender.
export async function setCatalogFeatured(slug: string, featured: boolean): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.rpc('admin_set_catalog_featured', {
    p_slug: slug,
    p_featured: featured,
  });
  if (error) {
    console.error('setCatalogFeatured failed:', error.message);
    return false;
  }
  return true;
}

export async function setCatalogGender(slug: string, gender: CatalogGender): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.rpc('admin_set_catalog_gender', {
    p_slug: slug,
    p_gender: gender,
  });
  if (error) {
    console.error('setCatalogGender failed:', error.message);
    return false;
  }
  return true;
}

export async function updateCatalogToggles(
  slug: string,
  toggles: Partial<Pick<Catalog, 'filterGender' | 'filterAge' | 'boostTopConverting'>>
): Promise<boolean> {
  if (!supabase) return false;
  if (Object.keys(toggles).length === 0) return true;
  // Uses a SECURITY DEFINER RPC (migration 094) so the anon admin client
  // can update the three boolean columns without a broad UPDATE RLS policy.
  const { error } = await supabase.rpc('admin_update_catalog_toggles', {
    p_slug:                 slug,
    p_filter_gender:        toggles.filterGender        ?? null,
    p_filter_age:           toggles.filterAge           ?? null,
    p_boost_top_converting: toggles.boostTopConverting  ?? null,
  });
  if (error) {
    console.error('updateCatalogToggles failed:', error.message);
    return false;
  }
  return true;
}

export interface CatalogSearchCounts {
  catalogName: string;
  count24h: number;
  count7d: number;
  countTotal: number;
}

export async function getCatalogSearchCounts(catalogNames: string[]): Promise<CatalogSearchCounts[]> {
  if (!supabase || catalogNames.length === 0) return [];
  const { data, error } = await supabase.rpc('catalog_search_counts', { catalog_names: catalogNames });
  if (error || !data) {
    console.warn('getCatalogSearchCounts failed:', error?.message);
    return [];
  }
  return (data as { catalog_name: string; count_24h: number; count_7d: number; count_total: number }[]).map(r => ({
    catalogName: r.catalog_name,
    count24h: r.count_24h ?? 0,
    count7d: r.count_7d ?? 0,
    countTotal: r.count_total ?? 0,
  }));
}

// ── Popular-catalog pills (search bar) ──────────────────────────────────────
// Powers the animated pill cloud above the desktop search bar. We rank the
// live, admin-curated catalogs by real search volume so "On fire" (last 24h)
// and "Most popular" (all-time) reflect actual demand, then fill the rest
// with the next most-searched catalogs. Falls back to a curated vibe list
// when no catalogs are configured yet, so the cloud is never empty.

export type CatalogPillKind = 'fire' | 'popular' | 'featured' | 'catalog';

export interface CatalogPill {
  name: string;
  kind: CatalogPillKind;
  count24h: number;
  countTotal: number;
}

const CURATED_FALLBACK_PILLS = [
  'Quiet luxury', 'Gorpcore', 'Date night', 'Old money', 'Coastal',
  'Office siren', 'Streetwear', 'Cozy season', 'Going out', 'Athleisure',
];

// One fewer than before (was 12) — the cloud read a touch crowded on mobile
// once the Following pill was added on top.
const MAX_PILLS = 11;

let popularPillsPromise: Promise<CatalogPill[]> | null = null;
let popularPillsAt = 0;
const POPULAR_PILLS_TTL_MS = 5 * 60_000; // 5 min — search demand drifts slowly.

export function getPopularCatalogPills(): Promise<CatalogPill[]> {
  const now = Date.now();
  if (popularPillsPromise && now - popularPillsAt < POPULAR_PILLS_TTL_MS) {
    return popularPillsPromise;
  }
  popularPillsAt = now;
  popularPillsPromise = (async () => {
    const catalogs = (await getLiveCatalogs()).filter(c => !c.isHome);
    if (catalogs.length === 0) {
      return CURATED_FALLBACK_PILLS.map<CatalogPill>(name => ({
        name, kind: 'catalog', count24h: 0, countTotal: 0,
      }));
    }
    const counts = await getCatalogSearchCounts(catalogs.map(c => c.name));
    const byName = new Map(counts.map(c => [c.catalogName, c]));
    const enriched = catalogs.map(c => ({
      name: c.name,
      isFeatured: c.isFeatured,
      count24h: byName.get(c.name)?.count24h ?? 0,
      countTotal: byName.get(c.name)?.countTotal ?? 0,
    }));

    const byTotal = [...enriched].sort((a, b) => b.countTotal - a.countTotal);
    const by24h = [...enriched].sort((a, b) => b.count24h - a.count24h);

    const pills: CatalogPill[] = [];
    const used = new Set<string>();
    const push = (e: typeof enriched[number] | undefined, kind: CatalogPillKind) => {
      if (!e || used.has(e.name)) return;
      used.add(e.name);
      pills.push({ name: e.name, kind, count24h: e.count24h, countTotal: e.countTotal });
    };

    push(by24h.find(e => e.count24h > 0), 'fire');        // 🔥 trending now
    push(byTotal.find(e => e.countTotal > 0), 'popular');  // ⭐ all-time
    push(enriched.find(e => e.isFeatured && !used.has(e.name)), 'featured'); // ✨ editor pick
    for (const e of byTotal) {                             // fill by demand
      if (pills.length >= MAX_PILLS) break;
      push(e, 'catalog');
    }
    return pills;
  })();
  popularPillsPromise.catch(() => { popularPillsPromise = null; });
  return popularPillsPromise;
}
