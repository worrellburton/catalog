import { supabase } from '~/utils/supabase';

export interface ProductAd {
  id: string;
  product_id: string;
  title: string | null;
  description: string | null;
  video_url: string | null;
  storage_path: string | null;
  thumbnail_url: string | null;
  affiliate_url: string | null;
  prompt: string | null;
  style: string;
  veo_model: string | null;
  status: 'pending' | 'generating' | 'done' | 'failed' | 'live' | 'paused';
  duration_seconds: number | null;
  aspect_ratio: string | null;
  resolution: string | null;
  cost_usd: number | null;
  impressions: number;
  clicks: number;
  error: string | null;
  enabled: boolean;
  created_at: string;
  completed_at: string | null;
  updated_at: string | null;
  // joined
  product?: { id: string; name: string | null; brand: string | null; price: string | null; image_url: string | null; url: string | null };
}

export interface CreateAdRequest {
  product_id: string;
  style: string;
  affiliate_url?: string;
}

const AD_SELECT = `
  *,
  product:products(id, name, brand, price, image_url, url)
`;

export async function getProductAds(): Promise<ProductAd[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('product_ads')
    .select(AD_SELECT)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('Failed to load product ads:', error.message);
    return [];
  }
  return (data || []) as ProductAd[];
}

export async function getProductAdsByStatus(status: string): Promise<ProductAd[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('product_ads')
    .select(AD_SELECT)
    .eq('status', status)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('Failed to load product ads:', error.message);
    return [];
  }
  return (data || []) as ProductAd[];
}

export async function getLiveAds(): Promise<ProductAd[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('product_ads')
    .select(AD_SELECT)
    .eq('status', 'live')
    .eq('enabled', true)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('Failed to load live ads:', error.message);
    return [];
  }
  return (data || []) as ProductAd[];
}

export async function createProductAd(req: CreateAdRequest): Promise<{ data: ProductAd | null; error: string | null }> {
  if (!supabase) return { data: null, error: 'Supabase not configured' };
  const { data, error } = await supabase
    .from('product_ads')
    .insert({
      product_id: req.product_id,
      style: req.style,
      affiliate_url: req.affiliate_url || null,
      status: 'pending',
    })
    .select(AD_SELECT)
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as ProductAd, error: null };
}

export async function createBatchAds(
  productIds: string[],
  style: string,
  count: number = 2,
): Promise<{ data: ProductAd[]; error: string | null }> {
  if (!supabase) return { data: [], error: 'Supabase not configured' };

  const rows = productIds.flatMap(product_id =>
    Array.from({ length: count }, () => ({
      product_id,
      style,
      status: 'pending' as const,
    }))
  );

  const { data, error } = await supabase
    .from('product_ads')
    .insert(rows)
    .select(AD_SELECT);

  if (error) return { data: [], error: error.message };
  return { data: (data || []) as ProductAd[], error: null };
}

export async function regenerateAd(id: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase
    .from('product_ads')
    .update({
      status: 'pending',
      error: null,
      video_url: null,
      storage_path: null,
      prompt: null,
      completed_at: null,
    })
    .eq('id', id);
  if (error) return { error: error.message };
  return { error: null };
}

export async function setAdLive(id: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase
    .from('product_ads')
    .update({ status: 'live', enabled: true })
    .eq('id', id);
  if (error) return { error: error.message };
  return { error: null };
}

export async function pauseAd(id: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase
    .from('product_ads')
    .update({ status: 'paused', enabled: false })
    .eq('id', id);
  if (error) return { error: error.message };
  return { error: null };
}

export async function deleteProductAd(id: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase
    .from('product_ads')
    .delete()
    .eq('id', id);
  if (error) return { error: error.message };
  return { error: null };
}

export async function updateAdAffiliateUrl(id: string, url: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase
    .from('product_ads')
    .update({ affiliate_url: url })
    .eq('id', id);
  if (error) return { error: error.message };
  return { error: null };
}

export async function trackAdImpression(id: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc('increment_ad_impressions', { ad_id: id });
  } catch { /* fire-and-forget */ }
}

export async function trackAdClick(id: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc('increment_ad_clicks', { ad_id: id });
  } catch { /* fire-and-forget */ }
}
