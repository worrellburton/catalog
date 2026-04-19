import { supabase } from '~/utils/supabase';

export interface ProductAd {
  id: string;
  product_id: string;
  look_id: string | null;
  title: string | null;
  description: string | null;
  video_url: string | null;
  storage_path: string | null;
  thumbnail_url: string | null;
  affiliate_url: string | null;
  prompt: string | null;
  style: string;
  veo_model: string | null;
  status: 'queued' | 'pending' | 'generating' | 'done' | 'failed' | 'live' | 'paused';
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
  console.log('[getLiveAds] called, supabase client exists:', !!supabase);
  if (!supabase) {
    console.warn('[getLiveAds] supabase is null, returning empty');
    return [];
  }
  try {
    // Prototype rule: show every ad that has a finished video, regardless
    // of promotion state. Only fail/paused are filtered since they have no
    // playable video or are explicitly disabled.
    const { data, error } = await supabase
      .from('product_ads')
      .select(AD_SELECT)
      .not('video_url', 'is', null)
      .not('status', 'in', '(failed,paused)')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[getLiveAds] query error:', error.message, error.details, error.hint);
      return [];
    }
    console.log('[getLiveAds] success, count:', data?.length, 'first ad:', data?.[0]?.id, 'video_url:', data?.[0]?.video_url?.substring(0, 60));
    return (data || []) as ProductAd[];
  } catch (err) {
    console.error('[getLiveAds] unexpected error:', err);
    return [];
  }
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

// Maximum concurrent generations the backend worker / Veo API can handle
// without rate-limiting. Anything above this gets queued.
const CONCURRENCY_LIMIT = 4;

export async function createBatchAds(
  productIds: string[],
  style: string,
  count: number = 2,
): Promise<{ data: ProductAd[]; error: string | null }> {
  if (!supabase) return { data: [], error: 'Supabase not configured' };

  // Count currently in-flight jobs so we only start up to CONCURRENCY_LIMIT
  // and queue the rest. Backend worker promotes 'queued' → 'pending' as slots
  // free up (see promoteQueuedAds below — called from the client poll loop).
  const { count: activeCount } = await supabase
    .from('product_ads')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pending', 'generating']);

  const inFlight = activeCount || 0;
  const slotsAvailable = Math.max(0, CONCURRENCY_LIMIT - inFlight);

  const allRows = productIds.flatMap(product_id =>
    Array.from({ length: count }, () => ({
      product_id,
      style,
      // Force portrait aspect so the generated video fills the vertical
      // feed cards end-to-end (no letterboxing).
      aspect_ratio: '9:16',
    }))
  );

  const rows = allRows.map((row, i) => ({
    ...row,
    status: (i < slotsAvailable ? 'pending' : 'queued') as 'pending' | 'queued',
  }));

  const { data, error } = await supabase
    .from('product_ads')
    .insert(rows)
    .select(AD_SELECT);

  if (error) return { data: [], error: error.message };
  return { data: (data || []) as ProductAd[], error: null };
}

// Promote oldest queued rows to pending up to the concurrency limit.
// Called periodically from the client poll loop so queued ads drain as
// pending/generating ads complete.
export async function promoteQueuedAds(): Promise<{ promoted: number; error: string | null }> {
  if (!supabase) return { promoted: 0, error: 'Supabase not configured' };

  const { count: activeCount } = await supabase
    .from('product_ads')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pending', 'generating']);

  const inFlight = activeCount || 0;
  const slotsAvailable = Math.max(0, CONCURRENCY_LIMIT - inFlight);
  if (slotsAvailable === 0) return { promoted: 0, error: null };

  const { data: queuedRows, error: queryErr } = await supabase
    .from('product_ads')
    .select('id')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(slotsAvailable);

  if (queryErr) return { promoted: 0, error: queryErr.message };
  const ids = (queuedRows || []).map(r => r.id);
  if (ids.length === 0) return { promoted: 0, error: null };

  const { error } = await supabase
    .from('product_ads')
    .update({ status: 'pending' })
    .in('id', ids);

  if (error) return { promoted: 0, error: error.message };
  return { promoted: ids.length, error: null };
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
