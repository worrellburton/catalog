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
  prompt_extra: string | null;
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
  is_elite?: boolean;
  created_at: string;
  completed_at: string | null;
  updated_at: string | null;
  // joined
  product?: { id: string; name: string | null; brand: string | null; price: string | null; image_url: string | null; url: string | null; catalog_tags?: string[] | null; is_elite?: boolean };
}

export interface CreateAdRequest {
  product_id: string;
  style: string;
  affiliate_url?: string;
}

const AD_SELECT = `
  *,
  product:products(id, name, brand, price, image_url, url, catalog_tags)
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

// Fetch every creative for products tagged with the given catalog name —
// mirrors the admin Catalogs view (status IN ('done','live'), video_url NOT
// NULL). Used by the consumer feed so searching for a catalog name lands on
// the full curated set, not just the elite/live subset `getLiveAds()` returns.
export async function getCatalogCreatives(catalogName: string): Promise<ProductAd[]> {
  if (!supabase) return [];
  const trimmed = catalogName.trim();
  if (!trimmed) return [];

  // Tags are stored as whatever casing the admin typed (usually lowercase).
  // Try the raw, lowercase, and title-case variants so a user searching
  // "White Shoes" still hits a catalog stored as "white shoes".
  const variants = Array.from(new Set([
    trimmed,
    trimmed.toLowerCase(),
    trimmed.replace(/\b\w/g, c => c.toUpperCase()),
  ]));
  const ors = variants
    .map(v => `catalog_tags.cs.{"${v.replace(/"/g, '\\"')}"}`)
    .join(',');

  const { data: prodRows, error: prodErr } = await supabase
    .from('products')
    .select('id')
    .or(ors);
  if (prodErr) {
    console.error('[getCatalogCreatives] product lookup error:', prodErr.message);
    return [];
  }
  const productIds = (prodRows || []).map(p => p.id as string);
  if (productIds.length === 0) return [];

  const { data, error } = await supabase
    .from('product_ads')
    .select(AD_SELECT)
    .in('product_id', productIds)
    .in('status', ['done', 'live'])
    .not('video_url', 'is', null)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[getCatalogCreatives] ad query error:', error.message);
    return [];
  }
  const rows = (data || []) as ProductAd[];
  return rows.filter(ad => (ad.product as { is_active?: boolean } | undefined)?.is_active !== false);
}

export async function getLiveAds(): Promise<ProductAd[]> {
  if (!supabase) return [];
  // Only surface explicitly approved (status='live') ads in the consumer feed.
  // New ads land at 'done' and must pass through the moderation queue first.
  // Boosted ads (boosted_until > now) sort to the top.
  // Also respect the product.is_active toggle — deactivating a product
  // should immediately pull its ads off the feed without requiring the
  // admin to individually pause each ad.
  // is_elite gate: the consumer feed is now curated — only hand-picked
  // creatives from the admin Creative view appear in the grid.
  const { data, error } = await supabase
    .from('product_ads')
    .select(AD_SELECT)
    .eq('status', 'live')
    .eq('is_elite', true)
    .not('video_url', 'is', null)
    .order('boosted_until', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[getLiveAds] query error:', error.message);
    return [];
  }
  const rows = (data || []) as ProductAd[];
  return rows.filter(ad => {
    // When the join returned a product row, it must be active. If the join
    // was filtered out (product deleted), keep the ad — the client-side
    // admin_hidden_products filter handles that case.
    const active = (ad.product as any)?.is_active;
    return active !== false;
  });
}

export async function boostAd(id: string, hours = 24): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('product_ads')
    .update({ boosted_until: until })
    .eq('id', id);
  return { error: error?.message || null };
}

export async function getModerationQueue(): Promise<ProductAd[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('product_ads')
    .select(AD_SELECT)
    .eq('status', 'done')
    .not('video_url', 'is', null)
    .order('created_at', { ascending: false });
  if (error) return [];
  return (data || []) as ProductAd[];
}

export async function rejectAd(id: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase
    .from('product_ads')
    .update({ status: 'paused', enabled: false })
    .eq('id', id);
  return { error: error?.message || null };
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

// Maximum concurrent generations the backend worker / Fal.ai account can run
// in parallel. Anything above this gets queued. Set to 2 to match Fal.ai's
// default starter concurrency (new accounts get 2 concurrent requests; scales
// up to 40 with credit purchases).
const CONCURRENCY_LIMIT = 2;

export interface GenerationOptions {
  durationSeconds?: number;
  withAudio?: boolean;
}

export async function createBatchAds(
  productIds: string[],
  style: string,
  count: number = 2,
  model?: string | string[],
  options: GenerationOptions = {},
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

  // When `model` is an array, each entry maps 1:1 to a generated row so you
  // can, e.g., run one Veo + one Seedance for the same product in one batch.
  // When it's a single string (or undefined), all rows share that model.
  const pickModel = (i: number): string | undefined => {
    if (Array.isArray(model)) return model[i % model.length];
    return model;
  };

  const allRows = productIds.flatMap(product_id =>
    Array.from({ length: count }, (_, i) => {
      const m = pickModel(i);
      return {
        product_id,
        style,
        // Force portrait aspect so the generated video fills the vertical
        // feed cards end-to-end (no letterboxing).
        aspect_ratio: '9:16',
        ...(m ? { veo_model: m } : {}),
        ...(options.durationSeconds != null ? { duration_seconds: options.durationSeconds } : {}),
        ...(options.withAudio != null ? { with_audio: options.withAudio } : {}),
      };
    })
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

export async function regenerateAd(id: string, promptExtra?: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  // prompt_extra is appended by the video-generator worker onto the freshly
  // generated prompt at regeneration time. Empty string clears it.
  const patch: Record<string, unknown> = {
    status: 'pending',
    error: null,
    video_url: null,
    storage_path: null,
    prompt: null,
    completed_at: null,
  };
  if (promptExtra !== undefined) {
    patch.prompt_extra = promptExtra.trim() ? promptExtra.trim() : null;
  }
  const { error } = await supabase.from('product_ads').update(patch).eq('id', id);
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

// Flip the elite flag on an ad AND its parent product together. Marking a
// product elite requires that at least one of its creatives is elite, so we
// keep the two in sync from this one entry point. Used by the admin Creative
// view and surfaces in investor deck v1.1's background feed.
export async function setAdElite(
  id: string,
  productId: string,
  isElite: boolean,
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error: adError } = await supabase
    .from('product_ads')
    .update({ is_elite: isElite })
    .eq('id', id);
  if (adError) return { error: adError.message };

  if (isElite) {
    const { error: productError } = await supabase
      .from('products')
      .update({ is_elite: true })
      .eq('id', productId);
    if (productError) return { error: productError.message };
  } else {
    // If no other elite creatives remain for this product, unmark it.
    const { data: remaining } = await supabase
      .from('product_ads')
      .select('id')
      .eq('product_id', productId)
      .eq('is_elite', true)
      .limit(1);
    if (!remaining || remaining.length === 0) {
      await supabase
        .from('products')
        .update({ is_elite: false })
        .eq('id', productId);
    }
  }
  return { error: null };
}

// Fetch every elite creative (product ads + generated look videos) with a
// playable video_url. Used by the deck v1.1 background feed so the investor
// view only ever shows hand-picked work.
export interface EliteCreative {
  id: string;
  source: 'product' | 'look';
  video_url: string;
}

export async function getEliteCreatives(): Promise<EliteCreative[]> {
  if (!supabase) return [];
  const [adsRes, vidsRes] = await Promise.all([
    supabase
      .from('product_ads')
      .select('id, video_url')
      .eq('is_elite', true)
      .not('video_url', 'is', null),
    supabase
      .from('generated_videos')
      .select('id, video_url')
      .eq('is_elite', true)
      .not('video_url', 'is', null),
  ]);
  const ads = (adsRes.data || []).map(r => ({ id: r.id as string, source: 'product' as const, video_url: r.video_url as string }));
  const vids = (vidsRes.data || []).map(r => ({ id: r.id as string, source: 'look' as const, video_url: r.video_url as string }));
  return [...ads, ...vids];
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
