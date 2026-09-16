// Products attributed to a creator directly, rather than through their looks.
//
// CreatorPage's Shop tab has always derived its products from look_products,
// so a creator with no looks had no products. An imported ShopMy creator has
// exactly that shape: hundreds of curated products and no video.

import { supabase } from '~/utils/supabase';
import type { Product } from '~/data/looks';

export interface CreatorProductRow {
  affiliate_url: string | null;
  sort_order: number;
  products: {
    id: string;
    name: string | null;
    brand: string | null;
    price: string | null;
    image_url: string | null;
    primary_image_url: string | null;
    primary_video_url: string | null;
    primary_hls_url: string | null;
    primary_video_poster_url: string | null;
    url: string | null;
    images: string[] | null;
  } | null;
}

/** Row → Product. Mirrors the mapping CreatorPage already does for
 *  look_products (CreatorPage.tsx:474-489), plus the creator's own link. */
export function mapCreatorProductRows(rows: CreatorProductRow[]): Product[] {
  return [...rows]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((r) => {
      const p = r.products;
      if (!p) return null;
      return {
        id: p.id,
        brand: p.brand || '',
        name: p.name || 'Untitled',
        price: p.price || '',
        url: p.url || '',
        image: p.primary_image_url || p.image_url || (p.images && p.images[0]) || undefined,
        video_url: p.primary_video_url || undefined,
        primary_hls_url: p.primary_hls_url || undefined,
        thumbnail_url: p.primary_video_poster_url || p.primary_image_url || p.image_url || undefined,
        // Rail 0 reads this at click time (app/services/affiliate.ts).
        affiliate_url: r.affiliate_url || undefined,
      } as Product;
    })
    .filter((p): p is Product => p !== null);
}

export async function getImportedCreatorProducts(handle: string): Promise<Product[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('creator_products')
    .select(`
      affiliate_url,
      sort_order,
      products ( id, name, brand, price, image_url, primary_image_url, primary_video_url, primary_hls_url, primary_video_poster_url, url, images )
    `)
    .eq('creator_handle', handle)
    .order('sort_order', { ascending: true });
  if (error || !data) return [];
  return mapCreatorProductRows(data as unknown as CreatorProductRow[]);
}
