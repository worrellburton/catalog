// Data for the consumer directory pages (/creators, /brands, /products,
// /catalogs) and the Products mega menu. Every loader is one or two
// round-trips over small tables; nothing here is paginated because the
// active catalog is well under PostgREST's 1000-row cap today.

// imports
import { supabase } from '~/utils/supabase';
import type { Product } from '~/data/looks';
import { getLiveCatalogs, type Catalog } from '~/services/catalogs';

// types
export type DirectoryKind = 'creators' | 'brands' | 'products' | 'catalogs';
/** The shopper-facing gender lens. 'all' is no filter. */
export type DirectoryGender = 'all' | 'women' | 'men';

export interface DirectoryCreator {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  looks: number;
  followers: number;
  /** Up to three recent look posters, newest first. */
  posters: string[];
  featured: boolean;
}

export interface DirectoryType {
  id: string;
  name: string;
  /** First-ring department the type sits under (fashion, beauty, home…). */
  department: string;
  sort: number;
  /** 24×24 path data drawn by the generate-type-icons function. */
  iconPath: string | null;
  counts: Record<DirectoryGender, number>;
  /** A product image to stand for the type (the hero slide). */
  heroImage: string | null;
}

export interface DirectoryTypeProduct extends Product {
  id: string;
  gender: string | null;
}

export interface DirectoryCatalog extends Catalog {
  productCount: number;
  /** Up to four product images for the tile strip. */
  images: string[];
}

// constants
export const DIRECTORY_KINDS: DirectoryKind[] = ['creators', 'brands', 'products', 'catalogs'];
export const DIRECTORY_LABELS: Record<DirectoryKind, string> = {
  creators: 'Creators',
  brands: 'Brands',
  products: 'Products',
  catalogs: 'Catalogs',
};
const DIRECTORY_PATH = /^\/(creators|brands|products|catalogs)(?:\/([^/?#]+))?\/?$/;
/** Departments that are internal / test scaffolding — never listed. */
const HIDDEN_TYPE_NAMES = new Set(['icon', 'placeholder', 'test-placeholder']);

// helpers
/** Parse a pathname into a directory kind (+ product type slug). */
export function parseDirectoryPath(pathname: string): { kind: DirectoryKind; type: string | null } | null {
  const m = pathname.match(DIRECTORY_PATH);
  if (!m) return null;
  return { kind: m[1] as DirectoryKind, type: m[2] ? decodeURIComponent(m[2]) : null };
}

export function directoryPath(kind: DirectoryKind, type?: string | null): string {
  return type ? `/${kind}/${encodeURIComponent(type)}` : `/${kind}`;
}

export function typeSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function genderMatches(g: string | null | undefined, lens: DirectoryGender): boolean {
  if (lens === 'all') return true;
  const v = (g ?? '').toLowerCase();
  if (v === 'unisex' || v === '') return true;
  return lens === 'women' ? (v === 'female' || v === 'women') : (v === 'male' || v === 'men');
}

// main logic
export async function listFeaturedCreatorHandles(): Promise<string[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from('featured_creators')
    .select('handle, sort_order')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  return ((data as { handle: string }[] | null) ?? []).map(r => r.handle);
}

export async function setCreatorFeatured(handle: string, on: boolean): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'No database' };
  const res = on
    ? await supabase.from('featured_creators').upsert({ handle }, { onConflict: 'handle' })
    : await supabase.from('featured_creators').delete().eq('handle', handle);
  return { error: res.error?.message ?? null };
}

/** Every creator in the directory, featured first (in their curated order),
 *  then the rest ranked by followers, then live looks. */
export async function listDirectoryCreators(): Promise<DirectoryCreator[]> {
  if (!supabase) return [];
  type CreatorRow = { handle: string; display_name: string | null; avatar_url: string | null };
  // The poster lives on looks_creative (one primary row per look), not on
  // looks itself — embed it and take the primary variant.
  type LookRow = {
    creator_handle: string | null;
    created_at: string | null;
    looks_creative: Array<{ thumbnail_url: string | null; is_primary: boolean | null }> | null;
  };
  type FollowRow = { followee_handle: string };
  const [creatorsRes, looksRes, followsRes, featured] = await Promise.all([
    supabase.from('creators').select('handle, display_name, avatar_url'),
    supabase.from('looks')
      .select('creator_handle, created_at, looks_creative ( thumbnail_url, is_primary )')
      .eq('status', 'live').eq('enabled', true).is('archived_at', null)
      .not('creator_handle', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase.from('creator_follows').select('followee_handle').limit(5000),
    listFeaturedCreatorHandles(),
  ]);
  const creators = (creatorsRes.data as CreatorRow[] | null) ?? [];
  const looks = (looksRes.data as LookRow[] | null) ?? [];
  const follows = (followsRes.data as FollowRow[] | null) ?? [];

  const lookCount = new Map<string, number>();
  const posters = new Map<string, string[]>();
  for (const l of looks) {
    const h = (l.creator_handle ?? '').toLowerCase();
    if (!h) continue;
    lookCount.set(h, (lookCount.get(h) ?? 0) + 1);
    const variants = l.looks_creative ?? [];
    const poster = (variants.find(v => v.is_primary) ?? variants[0])?.thumbnail_url ?? null;
    if (poster) {
      const list = posters.get(h) ?? [];
      if (list.length < 3) { list.push(poster); posters.set(h, list); }
    }
  }
  const followerCount = new Map<string, number>();
  for (const f of follows) {
    const h = (f.followee_handle ?? '').toLowerCase();
    if (h) followerCount.set(h, (followerCount.get(h) ?? 0) + 1);
  }
  const featuredIndex = new Map(featured.map((h, i) => [h.toLowerCase(), i]));

  const rows: DirectoryCreator[] = creators
    .filter(c => !!c.handle && !!c.display_name)
    .map(c => {
      const key = c.handle.toLowerCase();
      return {
        handle: c.handle,
        displayName: c.display_name ?? c.handle,
        avatarUrl: c.avatar_url,
        looks: lookCount.get(key) ?? 0,
        followers: followerCount.get(key) ?? 0,
        posters: posters.get(key) ?? [],
        featured: featuredIndex.has(key),
      };
    });
  rows.sort((a, b) => {
    const fa = featuredIndex.get(a.handle.toLowerCase());
    const fb = featuredIndex.get(b.handle.toLowerCase());
    if (fa != null || fb != null) {
      if (fa == null) return 1;
      if (fb == null) return -1;
      return fa - fb;
    }
    return b.followers - a.followers || b.looks - a.looks || a.displayName.localeCompare(b.displayName);
  });
  return rows;
}

type TypeRow = { id: string; name: string; parent_id: string | null; sort: number; icon_path: string | null };
type ProductRow = {
  id: string; name: string | null; brand: string | null; price: string | null; url: string | null;
  type: string | null; type_path: string | null; gender: string | null;
  primary_image_url: string | null; image_url: string | null;
};
const PRODUCT_SELECT = 'id, name, brand, price, url, type, type_path, gender, primary_image_url, image_url';

let productsCache: { at: number; rows: ProductRow[] } | null = null;
const PRODUCTS_TTL_MS = 60_000;

async function fetchActiveProducts(): Promise<ProductRow[]> {
  if (!supabase) return [];
  if (productsCache && Date.now() - productsCache.at < PRODUCTS_TTL_MS) return productsCache.rows;
  const { data } = await supabase
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1000);
  const rows = (data as ProductRow[] | null) ?? [];
  productsCache = { at: Date.now(), rows };
  return rows;
}

/** Does a product belong under a directory type (its own type, or any
 *  ancestor on the materialized path)? */
function productInType(p: ProductRow, typeName: string): boolean {
  const t = typeName.toLowerCase();
  if ((p.type ?? '').toLowerCase() === t) return true;
  const path = (p.type_path ?? '').toLowerCase();
  return path.split('/').map(s => s.trim()).includes(t);
}

function toProduct(p: ProductRow): DirectoryTypeProduct {
  return {
    id: p.id,
    name: p.name ?? '',
    brand: p.brand ?? '',
    price: p.price ?? '',
    url: p.url ?? '',
    image: p.primary_image_url ?? p.image_url ?? undefined,
    gender: p.gender,
  };
}

/** The second ring of the taxonomy (tops, shoes, skincare, decor…) with a
 *  product count per gender lens. Types with no active products are left
 *  out so the directory never shows an empty shelf. */
export async function listDirectoryTypes(): Promise<DirectoryType[]> {
  if (!supabase) return [];
  const [typesRes, products] = await Promise.all([
    supabase.from('product_types').select('id, name, parent_id, sort, icon_path').order('sort', { ascending: true }),
    fetchActiveProducts(),
  ]);
  const nodes = (typesRes.data as TypeRow[] | null) ?? [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  const out: DirectoryType[] = [];
  for (const n of nodes) {
    if (!n.parent_id || HIDDEN_TYPE_NAMES.has(n.name.toLowerCase())) continue;
    const parent = byId.get(n.parent_id);
    if (!parent || parent.parent_id) continue; // second ring only
    const members = products.filter(p => productInType(p, n.name));
    if (members.length === 0) continue;
    out.push({
      id: n.id,
      name: n.name,
      department: parent.name,
      sort: n.sort,
      iconPath: n.icon_path,
      heroImage: members.find(p => p.primary_image_url || p.image_url)?.primary_image_url
        ?? members.find(p => p.image_url)?.image_url ?? null,
      counts: {
        all: members.length,
        women: members.filter(p => genderMatches(p.gender, 'women')).length,
        men: members.filter(p => genderMatches(p.gender, 'men')).length,
      },
    });
  }
  // Departments in their taxonomy order, types by sort then name inside each.
  const deptSort = new Map(nodes.filter(n => !n.parent_id).map(n => [n.name, n.sort]));
  out.sort((a, b) =>
    (deptSort.get(a.department) ?? 999) - (deptSort.get(b.department) ?? 999)
    || a.sort - b.sort
    || a.name.localeCompare(b.name));
  return out;
}

/** Resolve a /products/<slug> segment back to the taxonomy type name. */
export async function resolveDirectoryType(slug: string): Promise<DirectoryType | null> {
  const types = await listDirectoryTypes();
  const key = slug.toLowerCase();
  return types.find(t => typeSlug(t.name) === key || t.name.toLowerCase() === key) ?? null;
}

/** Every active product for the lens — the /products screen. */
export async function listProducts(lens: DirectoryGender): Promise<DirectoryTypeProduct[]> {
  const products = await fetchActiveProducts();
  return products.filter(p => genderMatches(p.gender, lens)).map(toProduct);
}

/** Types with at least one product for the lens, grouped by department in
 *  taxonomy order (the mega menu's columns). */
export function groupTypesByDepartment(types: DirectoryType[], lens: DirectoryGender): Array<{ department: string; types: DirectoryType[] }> {
  const groups: Array<{ department: string; types: DirectoryType[] }> = [];
  for (const t of types) {
    if (t.counts[lens] === 0) continue;
    let g = groups.find(x => x.department === t.department);
    if (!g) { g = { department: t.department, types: [] }; groups.push(g); }
    g.types.push(t);
  }
  return groups;
}

export async function listProductsByType(typeName: string, lens: DirectoryGender): Promise<DirectoryTypeProduct[]> {
  const products = await fetchActiveProducts();
  return products
    .filter(p => productInType(p, typeName) && genderMatches(p.gender, lens))
    .map(toProduct);
}

/** Live catalogs a shopper can browse: the home feeds are skipped, and so
 *  is any catalog that has no products yet. */
export async function listDirectoryCatalogs(): Promise<DirectoryCatalog[]> {
  if (!supabase) return [];
  type CpRow = { catalog_id: string; products: { image_url: string | null; primary_image_url: string | null } | null };
  const [catalogs, cpRes] = await Promise.all([
    getLiveCatalogs(),
    supabase.from('catalog_products')
      .select('catalog_id, products ( image_url, primary_image_url )')
      .order('sort_order', { ascending: true })
      .limit(2000),
  ]);
  const counts = new Map<string, number>();
  const images = new Map<string, string[]>();
  for (const row of ((cpRes.data as unknown as CpRow[] | null) ?? [])) {
    counts.set(row.catalog_id, (counts.get(row.catalog_id) ?? 0) + 1);
    const img = row.products?.primary_image_url ?? row.products?.image_url;
    if (img) {
      const list = images.get(row.catalog_id) ?? [];
      if (list.length < 4) { list.push(img); images.set(row.catalog_id, list); }
    }
  }
  return catalogs
    .filter(c => !c.isHome && (counts.get(c.id) ?? 0) > 0)
    .map(c => ({ ...c, productCount: counts.get(c.id) ?? 0, images: images.get(c.id) ?? [] }));
}
