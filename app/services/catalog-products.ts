// Aggregates every product that appears across the signed-in creator's looks
// (deduped) and applies their personal display order from
// `creator_product_order`. Powers the "Products" tab in My Catalog, where the
// creator can drag-reorder the list. Owner-scoped via RLS.

import { supabase } from '~/utils/supabase';

export interface CatalogProduct {
  id: string;
  name: string;
  brand: string | null;
  price: string | null;
  image_url: string | null;
  url: string | null;
  type: string | null;
  subtype: string | null;
}

interface LookProductJoin {
  product_id: string;
  products: {
    id: string;
    name: string | null;
    brand: string | null;
    price: string | null;
    url: string | null;
    image_url: string | null;
    primary_image_url: string | null;
    type: string | null;
    subtype: string | null;
  } | null;
}

/** Every distinct product across the creator's looks, in their saved order
 *  (ordered rows first by sort_order, then the rest alphabetically). */
export async function getMyCatalogProducts(): Promise<CatalogProduct[]> {
  if (!supabase) return [];
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return [];

  // 1. The creator's looks.
  const { data: looks } = await supabase.from('looks').select('id').eq('user_id', uid);
  const lookIds = (looks || []).map(l => l.id as string);
  if (lookIds.length === 0) return [];

  // 2. Products attached to those looks, with details.
  const { data: lps } = await supabase
    .from('look_products')
    .select('product_id, products:products(id, name, brand, price, url, image_url, primary_image_url, type, subtype)')
    .in('look_id', lookIds);

  // 3. Dedupe by product id.
  const byId = new Map<string, CatalogProduct>();
  for (const lp of (lps as unknown as LookProductJoin[] | null) || []) {
    const p = lp.products;
    if (!p || byId.has(p.id)) continue;
    byId.set(p.id, {
      id: p.id,
      name: p.name || 'Product',
      brand: p.brand,
      price: p.price,
      image_url: p.primary_image_url || p.image_url,
      url: p.url,
      type: p.type,
      subtype: p.subtype,
    });
  }
  if (byId.size === 0) return [];

  // 4. The creator's saved order.
  const { data: order } = await supabase
    .from('creator_product_order')
    .select('product_id, sort_order')
    .eq('user_id', uid);
  const orderMap = new Map<string, number>();
  for (const o of (order as { product_id: string; sort_order: number }[] | null) || []) {
    orderMap.set(o.product_id, o.sort_order);
  }

  // 5. Ordered rows lead (by sort_order); unordered fall in behind, A→Z.
  const all = Array.from(byId.values());
  all.sort((a, b) => {
    const oa = orderMap.has(a.id) ? orderMap.get(a.id)! : Number.POSITIVE_INFINITY;
    const ob = orderMap.has(b.id) ? orderMap.get(b.id)! : Number.POSITIVE_INFINITY;
    if (oa !== ob) return oa - ob;
    return (a.name || '').localeCompare(b.name || '');
  });
  return all;
}

/** A creator's saved product order, keyed by product_id → sort_order.
 *  Public-readable (RLS) so the creator's CHOSEN order shows on their
 *  public catalog for every visitor, not just themselves. Returns an
 *  empty map when the creator hasn't reordered anything yet. */
export async function getCreatorProductOrder(userId: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!supabase || !userId) return map;
  const { data } = await supabase
    .from('creator_product_order')
    .select('product_id, sort_order')
    .eq('user_id', userId);
  for (const o of (data as { product_id: string; sort_order: number }[] | null) || []) {
    map.set(o.product_id, o.sort_order);
  }
  return map;
}

/** Persist a new order. `orderedIds` is the full product-id list in the
 *  desired top→bottom order; each row's index becomes its sort_order. */
export async function reorderMyCatalogProducts(orderedIds: string[]): Promise<void> {
  if (!supabase || orderedIds.length === 0) return;
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return;
  const rows = orderedIds.map((product_id, i) => ({
    user_id: uid,
    product_id,
    sort_order: i,
    updated_at: new Date().toISOString(),
  }));
  await supabase.from('creator_product_order').upsert(rows, { onConflict: 'user_id,product_id' });
}
