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
}

function edgeUrl(): string {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL || '';
  return `${baseUrl}/functions/v1/rainforest-product-lookup`;
}

async function authHeaders(): Promise<Record<string, string>> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
    'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  };
}

// Pulls one Amazon product via the rainforest-product-lookup edge function.
// Pass asin (e.g. "B073JYC4XM") OR url (full Amazon product page).
export async function lookupAmazonProduct(input: { asin?: string; url?: string; amazonDomain?: string }): Promise<RainforestProduct> {
  const res = await fetch(edgeUrl(), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      asin: input.asin,
      url: input.url,
      amazon_domain: input.amazonDomain,
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || `Lookup failed: ${res.status}`);
  }
  return json.product as RainforestProduct;
}

// Ingest a looked-up Rainforest product into public.products. Idempotent per
// URL: if a row with the same url exists, it's updated; otherwise inserted.
export async function ingestRainforestProduct(product: RainforestProduct): Promise<{ id: string } | null> {
  if (!supabase) return null;
  if (!product.name || !product.url) {
    throw new Error('Amazon product is missing a name or URL');
  }
  const payload = {
    name: product.name,
    brand: product.brand ?? 'Amazon',
    price: product.price ?? null,
    url: product.url,
    image_url: product.image_url ?? (product.images[0] ?? null),
    description: product.description ?? null,
    currency: product.currency ?? null,
    images: product.images.length > 0 ? product.images : null,
    is_active: true,
  };
  // Try to find an existing row by URL first — we don't have a unique
  // constraint we can rely on, so a two-step upsert keeps behaviour stable.
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
