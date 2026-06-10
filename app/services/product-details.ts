import { supabase } from '~/utils/supabase';

export interface ProductVariant {
  size: string | null;
  color: string | null;
  availability: boolean | null;
  sku: string | null;
  price_modifier: string | null;
}

export interface FitIntelligence {
  fit_type: string;
  body_type_match: string[];
  layering: boolean;
  warmth_rating: string;
  stretch_behavior: string;
  likely_feel: string;
  true_to_size: string;
  best_for_occasions: string[];
  season: string[];
}

export interface MaterialComposition {
  fiber: string;
  pct: number | null;
}

export interface ProductTaxonomy {
  category: string;
  subcategory: string;
  style: string | null;
}

export interface StylingMetadata {
  works_with: string[];
  occasion: string[];
  season: string[];
}

export interface ProductDetails {
  size_fit: string | null;
  materials_care: string | null;
  measurements: Record<string, number> | null;
  variants?: ProductVariant[] | null;
  size_chart?: Record<string, Record<string, number>> | null;
  normalized_measurements?: Record<string, Record<string, number>> | null;
  fit_intelligence?: FitIntelligence | null;
  materials_structured?: MaterialComposition[] | null;
  product_taxonomy?: ProductTaxonomy | null;
  styling_metadata?: StylingMetadata | null;
  confidence_scores?: Record<string, number> | null;
}

const SELECT =
  'size_fit, materials_care, measurements, variants, size_chart, ' +
  'normalized_measurements, fit_intelligence, materials_structured, ' +
  'product_taxonomy, styling_metadata, confidence_scores';

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
    if (data) return data as unknown as ProductDetails;
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
    if (data) return data as unknown as ProductDetails;
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
    if (data) return data as unknown as ProductDetails;
  }

  return null;
}
