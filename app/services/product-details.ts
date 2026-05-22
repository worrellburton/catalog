import { supabase } from '~/utils/supabase';

/**
 * The extended "spec sheet" copy for a product — populated by the
 * product-scraper Modal agent when a URL is added. Today only ~1% of
 * rows have these fields filled in; the ProductPage UI fetches them
 * on demand and renders a graceful "Not available" fallback for the
 * rest.
 */
export interface ProductDetails {
  size_fit: string | null;
  materials_care: string | null;
  /** Structured per-product measurements keyed by code → centimeters
   *  (e.g. `{ neck_width_cm: 16, chest_width_cm: 52 }`). Rendered as
   *  the SVG measurement diagram next to the size_fit copy. Null when
   *  the scraper hasn't backfilled the row yet. */
  measurements: Record<string, number> | null;
}

const SELECT = 'size_fit, materials_care, measurements';

/**
 * Fetch the spec-sheet fields for a single product. Tries the cheapest
 * identifier first (id → url → brand+name) so callers can pass whatever
 * they happen to have. Returns null if no row matches; the caller treats
 * that the same as "row exists but both fields are null".
 */
export async function getProductDetails(opts: {
  id?: string | null;
  url?: string | null;
  brand?: string | null;
  name?: string | null;
}): Promise<ProductDetails | null> {
  if (!supabase) return null;
  const { id, url, brand, name } = opts;

  if (id) {
    const { data, error } = await supabase
      .from('products')
      .select(SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error) {
      console.error('[getProductDetails:id]', error.message);
      return null;
    }
    if (data) return data as ProductDetails;
  }

  if (url) {
    const { data, error } = await supabase
      .from('products')
      .select(SELECT)
      .eq('url', url)
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('[getProductDetails:url]', error.message);
      return null;
    }
    if (data) return data as ProductDetails;
  }

  if (brand && name) {
    const { data, error } = await supabase
      .from('products')
      .select(SELECT)
      .eq('brand', brand)
      .eq('name', name)
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('[getProductDetails:brand+name]', error.message);
      return null;
    }
    if (data) return data as ProductDetails;
  }

  return null;
}
