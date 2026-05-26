import { supabase } from '~/utils/supabase';

/**
 * Global tuning dials backed by app_settings (text key/value).
 * Phase 2 of the /admin/dials buildout — adds the read/write API
 * for the Video → Still image ratio. Realtime channel ships in
 * Phase 3 so changes propagate to every connected client without
 * a refresh.
 *
 * Ratio semantics: an integer 0..100 where
 *   100 = every grid card autoplays video (current behaviour)
 *     0 = every grid card renders as a still image
 *   N  = roughly N% of cards play video, the rest show stills,
 *        split deterministically per-card so a refresh keeps the
 *        same cards on the same side.
 */

export const VIDEO_STILL_RATIO_KEY = 'video_still_ratio';
export const DEFAULT_VIDEO_STILL_RATIO = 100;

function parseRatio(raw: string | null | undefined): number {
  if (raw == null) return DEFAULT_VIDEO_STILL_RATIO;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_VIDEO_STILL_RATIO;
  return Math.max(0, Math.min(100, n));
}

/** One-shot read. Returns the default when Supabase isn't configured
 *  or the row doesn't exist yet — never throws to the caller. */
export async function getVideoStillRatio(): Promise<number> {
  if (!supabase) return DEFAULT_VIDEO_STILL_RATIO;
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', VIDEO_STILL_RATIO_KEY)
    .maybeSingle();
  if (error) {
    console.warn('[dials] read failed:', error.message);
    return DEFAULT_VIDEO_STILL_RATIO;
  }
  return parseRatio((data?.value as string | undefined) ?? null);
}

/** Persist a new ratio. Clamps to 0..100 before the round-trip.
 *  Throws on failure so the admin slider can surface an error toast. */
export async function setVideoStillRatio(value: number): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: VIDEO_STILL_RATIO_KEY, value: String(clamped) }, { onConflict: 'key' });
  if (error) throw error;
}

/**
 * Listen for ratio changes pushed by other clients (admin moving the
 * slider on /admin/dials, another tab updating the value, etc.).
 * Returns the unsubscribe fn. The callback fires with the freshly
 * parsed value any time the app_settings row for this key is
 * INSERTed or UPDATEd. Filtering happens server-side so unrelated
 * settings changes don't wake the consumer feed.
 */
export function subscribeVideoStillRatio(
  onChange: (value: number) => void,
): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`dials:${VIDEO_STILL_RATIO_KEY}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'app_settings',
        filter: `key=eq.${VIDEO_STILL_RATIO_KEY}`,
      },
      (payload) => {
        const next = (payload.new as { value?: string } | null)?.value;
        onChange(parseRatio(next ?? null));
      },
    )
    .subscribe();
  return () => { void supabase!.removeChannel(channel); };
}

// ────────────────────────────────────────────────────────────────────
// "Products image-only" toggle. When ON, the consumer feed renders
// any tile backed by a product (no look attached) as just the
// product's image — no autoplay video. Looks (look_id present)
// continue to play video as normal.
//
// Default: false (current behaviour — products and looks both play
// video). Boolean value persisted as 'true' / 'false' string in
// app_settings to keep the same simple text column the ratio uses.
// ────────────────────────────────────────────────────────────────────

export const PRODUCTS_IMAGE_ONLY_KEY = 'products_image_only';
export const DEFAULT_PRODUCTS_IMAGE_ONLY = false;

export const SHOW_BRAND_LOGOS_KEY = 'show_brand_logos';
export const DEFAULT_SHOW_BRAND_LOGOS = false;

function parseBool(raw: string | null | undefined, fallback: boolean): boolean {
  if (raw == null) return fallback;
  return raw.trim().toLowerCase() === 'true';
}

export async function getProductsImageOnly(): Promise<boolean> {
  if (!supabase) return DEFAULT_PRODUCTS_IMAGE_ONLY;
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', PRODUCTS_IMAGE_ONLY_KEY)
    .maybeSingle();
  if (error) {
    console.warn('[dials] products_image_only read failed:', error.message);
    return DEFAULT_PRODUCTS_IMAGE_ONLY;
  }
  return parseBool((data?.value as string | undefined) ?? null, DEFAULT_PRODUCTS_IMAGE_ONLY);
}

export async function setProductsImageOnly(value: boolean): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: PRODUCTS_IMAGE_ONLY_KEY, value: String(value) }, { onConflict: 'key' });
  if (error) throw error;
}

export function subscribeProductsImageOnly(
  onChange: (value: boolean) => void,
): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`dials:${PRODUCTS_IMAGE_ONLY_KEY}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'app_settings',
        filter: `key=eq.${PRODUCTS_IMAGE_ONLY_KEY}`,
      },
      (payload) => {
        const next = (payload.new as { value?: string } | null)?.value;
        onChange(parseBool(next ?? null, DEFAULT_PRODUCTS_IMAGE_ONLY));
      },
    )
    .subscribe();
  return () => { void supabase!.removeChannel(channel); };
}

// ────────────────────────────────────────────────────────────────────
// "Show brand logos" toggle. When ON, the consumer feed swaps the
// brand text label on each tile for the brand's logo image (fetched
// from public.brand_logos). Default OFF.
// ────────────────────────────────────────────────────────────────────

export async function getShowBrandLogos(): Promise<boolean> {
  if (!supabase) return DEFAULT_SHOW_BRAND_LOGOS;
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', SHOW_BRAND_LOGOS_KEY)
    .maybeSingle();
  if (error) {
    console.warn('[dials] show_brand_logos read failed:', error.message);
    return DEFAULT_SHOW_BRAND_LOGOS;
  }
  return parseBool((data?.value as string | undefined) ?? null, DEFAULT_SHOW_BRAND_LOGOS);
}

export async function setShowBrandLogos(value: boolean): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: SHOW_BRAND_LOGOS_KEY, value: String(value) }, { onConflict: 'key' });
  if (error) throw error;
}

export function subscribeShowBrandLogos(onChange: (value: boolean) => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`dials:${SHOW_BRAND_LOGOS_KEY}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'app_settings', filter: `key=eq.${SHOW_BRAND_LOGOS_KEY}` },
      (payload) => {
        const next = (payload.new as { value?: string } | null)?.value;
        onChange(parseBool(next ?? null, DEFAULT_SHOW_BRAND_LOGOS));
      },
    )
    .subscribe();
  return () => { void supabase!.removeChannel(channel); };
}
