import { supabase } from '~/utils/supabase';

export interface RainforestProduct {
  asin: string | null;
  name: string;
  brand: string | null;
  price: string | null;
  currency: string | null;
  description: string | null;
  url: string | null;
  image_url: string | null;
  images: string[];
  categories: string[];
  rating?: number | null;
  rating_count?: number | null;
}

const FN_NAME = 'rainforest-product-lookup';

// Pulls one Amazon product via the rainforest-product-lookup edge function.
// Pass asin (e.g. "B073JYC4XM") OR url (full Amazon product page).
export async function lookupAmazonProduct(input: { asin?: string; url?: string; amazonDomain?: string }): Promise<RainforestProduct> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.functions.invoke(FN_NAME, {
    body: { asin: input.asin, url: input.url, amazon_domain: input.amazonDomain },
  });
  if (error) throw new Error(error.message || 'Lookup failed');
  if (!data?.success) throw new Error(data?.error || 'Lookup failed');
  return data.product as RainforestProduct;
}

// Searches Amazon by keyword. Returns the top N results (default 20) in the
// same normalized shape as lookupAmazonProduct.
export async function searchAmazonProducts(keyword: string, limit = 20): Promise<RainforestProduct[]> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.functions.invoke(FN_NAME, {
    body: { keyword, limit },
  });
  if (error) throw new Error(error.message || 'Search failed');
  if (!data?.success) throw new Error(data?.error || 'Search failed');
  return (data.products ?? []) as RainforestProduct[];
}

// Ingest a looked-up Rainforest product into public.products. Idempotent per
// URL: if a row with the same url exists, it's updated; otherwise inserted.
export async function ingestRainforestProduct(product: RainforestProduct): Promise<{ id: string } | null> {
  if (!supabase) return null;
  if (!product.name || !product.url) {
    throw new Error('Amazon product is missing a name or URL');
  }
  // Require a usable image — without one, downstream image-to-video generation
  // fails with "Field required, loc: ['body', 'image_url']" at fal.ai.
  const imageUrl = product.image_url
    ?? product.images.find(u => typeof u === 'string' && u.trim().length > 0)
    ?? null;
  if (!imageUrl) {
    throw new Error('Amazon product is missing an image — skipping ingest');
  }
  const payload = {
    name: product.name,
    brand: product.brand ?? 'Amazon',
    price: product.price ?? null,
    url: product.url,
    image_url: imageUrl,
    description: product.description ?? null,
    currency: product.currency ?? null,
    images: product.images.length > 0 ? product.images : null,
    is_active: true,
  };
  const { data: existing } = await supabase
    .from('products')
    .select('id')
    .eq('url', product.url)
    .maybeSingle();
  if (existing?.id) {
    const { error } = await supabase.from('products').update(payload).eq('id', existing.id);
    if (error) {
      console.error('ingestRainforestProduct update failed:', error.message);
      return null;
    }
    return { id: existing.id };
  }
  const { data: inserted, error } = await supabase
    .from('products')
    .insert(payload)
    .select('id')
    .single();
  if (error || !inserted) {
    console.error('ingestRainforestProduct insert failed:', error?.message);
    return null;
  }
  return { id: inserted.id };
}

// Batch ingest — used by the search-mode multi-select flow.
export async function ingestRainforestProducts(products: RainforestProduct[]): Promise<{ inserted: number; failed: number }> {
  let inserted = 0;
  let failed = 0;
  for (const p of products) {
    try {
      const row = await ingestRainforestProduct(p);
      if (row) inserted += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { inserted, failed };
}
