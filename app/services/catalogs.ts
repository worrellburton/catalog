import { supabase } from '~/utils/supabase';

export interface Catalog {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  themePrompt: string | null;
  gender: 'all' | 'men' | 'women';
  coverUrl: string | null;
  sortOrder: number;
  isFeatured: boolean;
  status: 'draft' | 'live' | 'archived';
}

interface CatalogRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  theme_prompt: string | null;
  gender: 'all' | 'men' | 'women';
  cover_url: string | null;
  sort_order: number;
  is_featured: boolean;
  status: 'draft' | 'live' | 'archived';
}

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
  };
}

export async function getLiveCatalogs(): Promise<Catalog[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('catalogs')
    .select('id, slug, name, description, theme_prompt, gender, cover_url, sort_order, is_featured, status')
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
    .select('id, slug, name, description, theme_prompt, gender, cover_url, sort_order, is_featured, status')
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
    .select('id, slug, name, description, theme_prompt, gender, cover_url, sort_order, is_featured, status')
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
