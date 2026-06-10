// Manual product entry (admin "Add Manually" flow on /admin/data):
// 1. extractProductFromScreenshot — Claude vision reads an uploaded
//    screenshot and returns the structured fields (name/brand/price/…).
// 2. uploadProductImage — admin-supplied primary/gallery images go to the
//    user-uploads bucket (same public bucket lens-search uses).
// 3. createManualProduct — inserts the reviewed product row, active
//    immediately (no scraper involved: source='manual', scrape done).

import { supabase } from '~/utils/supabase';

export interface ExtractedProductFields {
  name: string;
  brand: string;
  price: string;
  currency: string;
  description: string;
  type: string;
  gender: string;
}

export interface ManualProductInput extends ExtractedProductFields {
  url: string;
  primaryImageUrl: string;
  galleryImageUrls: string[];
}

/** The same column set the Add Products ingest selects, so the inserted
 *  row can merge straight into the /admin/data products table. */
const INSERT_SELECT =
  'id, name, brand, price, url, image_url, images, primary_image_url, primary_image_polished, '
  + 'primary_image_pre_polish_url, primary_video_url, primary_video_status, primary_video_request_id, '
  + 'primary_video_poster_url, scraped_at, scrape_status, is_active, is_elite, is_platform, type, '
  + 'subtype, gender, created_at, source, size_fit, materials_care';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      resolve(url.slice(url.indexOf(',') + 1)); // strip the data: prefix
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export async function extractProductFromScreenshot(file: File): Promise<ExtractedProductFields> {
  if (!supabase) throw new Error('Supabase not configured');
  const image_base64 = await fileToBase64(file);
  const { data, error } = await supabase.functions.invoke('extract-product-screenshot', {
    body: { image_base64, media_type: file.type || 'image/png' },
  });
  if (error) throw new Error(error.message);
  const resp = data as { success?: boolean; error?: string; fields?: ExtractedProductFields };
  if (!resp?.success || !resp.fields) throw new Error(resp?.error || 'Extraction failed');
  return resp.fields;
}

export async function uploadProductImage(file: File): Promise<string> {
  if (!supabase) throw new Error('Supabase not configured');
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `manual-products/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from('user-uploads')
    .upload(path, file, { cacheControl: '31536000', upsert: false, contentType: file.type || 'image/png' });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from('user-uploads').getPublicUrl(path);
  return data.publicUrl;
}

export async function createManualProduct(input: ManualProductInput): Promise<Record<string, unknown>> {
  if (!supabase) throw new Error('Supabase not configured');
  if (!input.name.trim()) throw new Error('Name is required');
  if (!input.primaryImageUrl) throw new Error('A primary image is required');
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('products')
    .insert({
      name: input.name.trim(),
      brand: input.brand.trim() || null,
      price: input.price.trim() || null,
      currency: input.currency.trim() || null,
      description: input.description.trim() || null,
      type: input.type.trim().toLowerCase() || null,
      gender: input.gender || null,
      url: input.url.trim() || null,
      image_url: input.primaryImageUrl,
      primary_image_url: input.primaryImageUrl,
      primary_image_picked_by: 'manual',
      images: [input.primaryImageUrl, ...input.galleryImageUrls],
      is_active: true,
      source: 'manual',
      // Nothing left to scrape — the admin supplied the data directly.
      scrape_status: 'done',
      scraped_at: nowIso,
    })
    .select(INSERT_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as Record<string, unknown>;
}
