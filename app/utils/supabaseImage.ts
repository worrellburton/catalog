// Supabase Storage image transform helper.
//
// Storage URLs of the form:
//   https://{ref}.supabase.co/storage/v1/object/public/{bucket}/{path}
// can be rewritten to the on-the-fly render endpoint:
//   https://{ref}.supabase.co/storage/v1/render/image/public/{bucket}/{path}?width=480&quality=70
// which returns a resized + recompressed image instead of the full original.
//
// We use this for card thumbnails (~240–400 px on screen) where the original
// upload could easily be 2000+ px and 2 MB. Cuts bytes-on-the-wire by 5–20x
// without any visible quality loss at the displayed size.
//
// Non-Supabase URLs (Unsplash, brand sites) pass through unchanged — those
// hosts have their own resize APIs (Unsplash uses ?w=200) but we only need
// to handle our own.

const STORAGE_PATH_RE = /\/storage\/v1\/object\/public\//;

interface ResizeOptions {
  width?: number;
  height?: number;
  quality?: number;
  resize?: 'cover' | 'contain' | 'fill';
  /** Output format. Defaults to 'webp' — supported in Chrome 32+,
   *  Edge 18+, Firefox 65+, and Safari 14+ (≥97% global support).
   *  Pass 'origin' to keep the original encoding (e.g. when delivering
   *  a transparent PNG that needs alpha). */
  format?: 'webp' | 'origin';
}

export function supabaseImage(url: string | null | undefined, opts: ResizeOptions = {}): string {
  if (!url) return '';
  if (!STORAGE_PATH_RE.test(url)) return url;

  const transformed = url.replace(
    '/storage/v1/object/public/',
    '/storage/v1/render/image/public/',
  );
  const params = new URLSearchParams();
  if (opts.width) params.set('width', String(opts.width));
  if (opts.height) params.set('height', String(opts.height));
  params.set('quality', String(opts.quality ?? 70));
  if (opts.resize) params.set('resize', opts.resize);
  // WebP at quality 70 is typically 25–35% smaller than the equivalent
  // JPEG with no perceptible difference at thumbnail sizes. Stacks on
  // top of the resize savings — a 2 MB original card becomes ~20 KB
  // instead of ~30 KB.
  params.set('format', opts.format ?? 'webp');

  const sep = transformed.includes('?') ? '&' : '?';
  return `${transformed}${sep}${params.toString()}`;
}
