// One product for the admin product page (/admin/product/:id): the full row,
// its creative videos, and the image / video generation sequences.

// imports
import { supabase } from '~/utils/supabase';

// types
export interface AdminProduct {
  id: string;
  name: string | null;
  brand: string | null;
  price: string | null;
  discounted_price: string | null;
  url: string | null;
  image_url: string | null;
  images: string[];
  description: string | null;
  is_active: boolean | null;
  type: string | null;
  subtype: string | null;
  gender: string | null;
  source: string | null;
  created_at: string | null;
  scraped_at: string | null;
  scrape_status: string | null;
  size_fit: string | null;
  materials_care: string | null;
  haiku_context: string | null;
  affiliate_url: string | null;
  affiliate_source: string | null;
  barcode: string | null;
  barcode_type: string | null;
  primary_image_url: string | null;
  primary_image_polished: boolean | null;
  primary_video_url: string | null;
  primary_video_poster_url: string | null;
  primary_video_status: string | null;
  url_status: number | null;
  url_checked_at: string | null;
}

export interface ProductCreativeClip {
  id: string;
  video_url: string | null;
  thumbnail_url: string | null;
  status: string | null;
  model: string | null;
  enabled: boolean | null;
  impressions: number | null;
  clicks: number | null;
  created_at: string | null;
}

export type MediaStep = 'pick' | 'polish' | 'video';

// constants
const PRODUCT_COLUMNS = [
  'id', 'name', 'brand', 'price', 'discounted_price', 'url', 'image_url', 'images', 'description', 'is_active',
  'type', 'subtype', 'gender', 'source', 'created_at', 'scraped_at', 'scrape_status', 'size_fit', 'materials_care',
  'haiku_context', 'affiliate_url', 'affiliate_source', 'barcode', 'barcode_type', 'primary_image_url',
  'primary_image_polished', 'primary_video_url', 'primary_video_poster_url', 'primary_video_status',
  'url_status', 'url_checked_at',
].join(', ');

// main logic
export async function loadAdminProduct(id: string): Promise<AdminProduct | null> {
  if (!supabase || !id) return null;
  const { data, error } = await supabase.from('products').select(PRODUCT_COLUMNS).eq('id', id).maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as AdminProduct & { images: unknown };
  return { ...row, images: Array.isArray(row.images) ? row.images.filter((u): u is string => typeof u === 'string') : [] };
}

export async function loadProductCreatives(id: string): Promise<ProductCreativeClip[]> {
  if (!supabase || !id) return [];
  const { data } = await supabase
    .from('product_creative')
    .select('id, video_url, thumbnail_url, status, model, enabled, impressions, clicks, created_at')
    .eq('product_id', id)
    .order('created_at', { ascending: false });
  return (data as ProductCreativeClip[] | null) ?? [];
}

/**
 * The media sequences behind the product page's Generate buttons.
 * 'image': pick a primary photo if there isn't one → polish it.
 * 'video': the image sequence if the primary isn't polished → render the
 * primary video (async on fal; the poster follows via a DB trigger).
 * Resolves with an error message, or null on success.
 */
export async function runProductMediaSequence(
  product: AdminProduct,
  mode: 'image' | 'video',
  onStep: (step: MediaStep) => void,
): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured';
  const sb = supabase;
  const invoke = async (fn: string, body: Record<string, unknown>) => {
    const { data, error } = await sb.functions.invoke(fn, { body });
    if (error || !data?.success) return (data?.error as string | undefined) || error?.message || `${fn} failed`;
    return null;
  };
  if (!product.primary_image_url) {
    const imgs = [...product.images];
    if (product.image_url && !imgs.includes(product.image_url)) imgs.push(product.image_url);
    if (imgs.length === 0) return 'No product photos to work from';
    onStep('pick');
    const err = await invoke('pick-primary-image', { product_id: product.id, name: product.name || '', brand: product.brand || '', image_urls: imgs });
    if (err) return err;
  }
  if (mode === 'image' || !product.primary_image_polished || !product.primary_image_url) {
    onStep('polish');
    const err = await invoke('polish-primary-image', { product_id: product.id });
    if (err || mode === 'image') return err;
  }
  onStep('video');
  return invoke('generate-primary-video', { product_id: product.id });
}
