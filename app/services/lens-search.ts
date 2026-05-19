/**
 * Client wrappers for the `lens-search` + `lens-ingest` edge functions.
 *
 * lens-search: takes a Style-sheet image URL (or a cropped region URL)
 *   and returns visual-match shopping results from Google Lens via
 *   SerpAPI. The matches are NOT persisted yet — the user picks which
 *   ones they want to shop / try on.
 *
 * lens-ingest: persists the user's picked matches into public.products
 *   (service-role, dedupes by url, queues embed-product) so the
 *   /generate wizard can deep-link to them via ?product_url=… and the
 *   try-on pipeline can resolve them.
 */

import { supabase, SUPABASE_URL } from '~/utils/supabase';

export interface LensMatch {
  // Set when the result is returned from (or persisted into) the
  // lens_results cache table. Lets the client back-reference the row
  // for ingest patching and "already tried on" badges.
  id?: string | null;
  position: number;
  title: string;
  source: string;
  source_icon: string;
  link: string;
  thumbnail: string;
  image: string;
  price: string;
  brand: string;
  rating: number | null;
  reviews: number | null;
  // Set when the result has been previously ingested into the
  // catalog via lens-ingest. Used to render an "already tried on"
  // chip on the result tile.
  ingested_product_id?: string | null;
}

export interface LensSearchResult {
  matches: LensMatch[];
  cached?: boolean;
  searchId?: string | null;
  error?: string;
}

export interface LensBBox {
  /** x of top-left in 0..1 image-space */
  x: number;
  /** y of top-left in 0..1 image-space */
  y: number;
  /** width in 0..1 image-space */
  w: number;
  /** height in 0..1 image-space */
  h: number;
}

export interface LensIngestResultItem {
  id: string | null;
  name: string;
  url: string;
  deduped: boolean;
  error?: string;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  // Lens functions sit behind the standard Supabase JWT gate. We pass
  // the user's access token when one exists so usage rows attribute to
  // the right session.
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function lensSearch(args: {
  imageUrl: string;
  q?: string;
  country?: string;
  bbox?: LensBBox;
}): Promise<LensSearchResult> {
  try {
    const auth = await getAuthHeaders();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/lens-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        image_url: args.imageUrl,
        q: args.q ?? '',
        country: args.country ?? 'us',
        bbox: args.bbox ?? undefined,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      return { matches: [], error: json.error || `Lens search failed (${res.status})` };
    }
    return {
      matches: Array.isArray(json.matches) ? json.matches : [],
      cached: !!json.cached,
      searchId: typeof json.search_id === 'string' ? json.search_id : null,
    };
  } catch (err) {
    return { matches: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export interface LensIngestInput {
  name: string;
  url: string;
  image_url: string;
  brand?: string | null;
  price?: string | null;
  gender?: 'men' | 'women' | 'unisex';
}

export async function lensIngest(args: {
  items: LensIngestInput[];
  sourceImageUrl?: string;
}): Promise<{ ingested: LensIngestResultItem[]; error?: string }> {
  try {
    const auth = await getAuthHeaders();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/lens-ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        items: args.items,
        source_image_url: args.sourceImageUrl,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      return { ingested: [], error: json.error || `Lens ingest failed (${res.status})` };
    }
    return { ingested: Array.isArray(json.ingested) ? json.ingested : [] };
  } catch (err) {
    return { ingested: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Crop a region out of a public image URL client-side and upload the
 * cropped JPEG to the `user-uploads` bucket under a `lens-crops/`
 * prefix. Returns the public URL of the crop so it can be passed back
 * to lens-search as the new image_url.
 *
 * Why crop client-side instead of letting the edge function do it:
 *   • SerpAPI's Google Lens engine accepts a single image URL with
 *     no native bbox parameter, so we have to materialize the crop
 *     somewhere reachable from SerpAPI's fetchers anyway.
 *   • Doing it in the browser avoids round-tripping the source image
 *     through our Deno functions and skips the cold-start cost.
 *
 * The bbox is normalized 0..1 image-space so it survives whatever
 * scaling the lightbox / crop tool did to render the source.
 */
export async function cropAndUploadLensRegion(args: {
  userId: string;
  sourceImageUrl: string;
  bbox: LensBBox;
}): Promise<{ croppedUrl?: string; error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' };
  try {
    const img = await loadImage(args.sourceImageUrl);
    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;
    const cropX = Math.max(0, Math.round(args.bbox.x * naturalW));
    const cropY = Math.max(0, Math.round(args.bbox.y * naturalH));
    const cropW = Math.min(naturalW - cropX, Math.round(args.bbox.w * naturalW));
    const cropH = Math.min(naturalH - cropY, Math.round(args.bbox.h * naturalH));
    if (cropW < 32 || cropH < 32) {
      return { error: 'Crop area is too small — drag a larger box.' };
    }

    const canvas = document.createElement('canvas');
    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { error: 'Canvas not supported in this browser.' };
    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    const blob: Blob | null = await new Promise(resolve =>
      canvas.toBlob(b => resolve(b), 'image/jpeg', 0.9),
    );
    if (!blob) return { error: 'Failed to encode crop.' };

    const path = `${args.userId}/lens-crops/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error: upErr } = await supabase.storage
      .from('user-uploads')
      .upload(path, blob, {
        contentType: 'image/jpeg',
        cacheControl: 'public, max-age=31536000, immutable',
        upsert: false,
      });
    if (upErr) return { error: upErr.message };
    const { data } = supabase.storage.from('user-uploads').getPublicUrl(path);
    return { croppedUrl: data?.publicUrl ?? '' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Count how many Lens results from each Style sheet image have been
 * ingested into the user's catalog. Used by the Style page to render
 * a "{n} saved" badge on tiles that have try-on history, so the user
 * can spot which looks they've already shopped without re-scanning.
 *
 * Returns a Map keyed by source_image_url so the page can do an O(1)
 * lookup per tile.
 */
export async function getLensIngestCounts(imageUrls: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!supabase || imageUrls.length === 0) return out;
  const { data, error } = await supabase
    .from('lens_searches')
    .select('source_image_url, lens_results!inner(ingested_product_id)')
    .in('source_image_url', imageUrls)
    .not('lens_results.ingested_product_id', 'is', null);
  if (error || !data) return out;
  for (const row of data as Array<{ source_image_url: string; lens_results: Array<{ ingested_product_id: string | null }> }>) {
    const cur = out.get(row.source_image_url) ?? 0;
    const add = (row.lens_results ?? []).filter(r => r.ingested_product_id).length;
    out.set(row.source_image_url, cur + add);
  }
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Style sheet images come from a Supabase storage bucket served
    // with permissive CORS, so the canvas read is allowed. crossOrigin
    // here only matters when we hit a third-party URL — leave it on
    // 'anonymous' so the toBlob doesn't taint.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load source image for crop.'));
    img.src = src;
  });
}
