/**
 * Supabase storage image-transform helper. Rewrites a public-object
 * URL into the render variant with width/quality params so we don't
 * ship the full-resolution original to every tile.
 *
 * `https://<proj>.supabase.co/storage/v1/object/public/<bucket>/<path>`
 *   becomes
 * `https://<proj>.supabase.co/storage/v1/render/image/public/<bucket>/<path>?width=400&quality=75&resize=cover`
 *
 * No-op for non-Supabase URLs (Google avatars, external product images,
 * data: URIs, etc.) so it's safe to apply blindly.
 */

interface TransformOpts {
  /** Target rendered width in CSS pixels. The helper auto-doubles on
   *  retina via the `2x` suffix on srcSet, so pass the natural size. */
  width: number;
  /** Optional height. When omitted, Supabase preserves aspect ratio. */
  height?: number;
  /** 1–100. Defaults to 75 which is visually indistinguishable from
   *  the original for thumbnails but ~60% smaller. */
  quality?: number;
  /** How the image fits the requested box. `cover` crops; `contain`
   *  letterboxes. Defaults to `cover` since most tiles are cropped. */
  resize?: 'cover' | 'contain' | 'fill';
}

const SUPABASE_OBJECT_RE = /\/storage\/v1\/object\/public\//;

export function withTransform(url: string | null | undefined, opts: TransformOpts): string | undefined {
  if (!url) return undefined;
  if (!SUPABASE_OBJECT_RE.test(url)) return url;
  const transformed = url.replace(SUPABASE_OBJECT_RE, '/storage/v1/render/image/public/');
  const params = new URLSearchParams();
  params.set('width', String(opts.width));
  if (opts.height) params.set('height', String(opts.height));
  params.set('quality', String(opts.quality ?? 75));
  params.set('resize', opts.resize ?? 'cover');
  return `${transformed}?${params.toString()}`;
}

/** Build a `srcSet` string for retina. Caller passes the 1× width and
 *  gets `<url@1x> 1x, <url@2x> 2x` so the browser picks the right one. */
export function transformSrcSet(url: string | null | undefined, opts: TransformOpts): string | undefined {
  if (!url) return undefined;
  if (!SUPABASE_OBJECT_RE.test(url)) return undefined;
  const oneX = withTransform(url, opts);
  const twoX = withTransform(url, { ...opts, width: opts.width * 2, height: opts.height ? opts.height * 2 : undefined });
  if (!oneX || !twoX) return undefined;
  return `${oneX} 1x, ${twoX} 2x`;
}
