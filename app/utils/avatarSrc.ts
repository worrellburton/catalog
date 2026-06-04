// Avatar URL helpers — request a higher-resolution variant of a profile
// image where the host supports it. Storefronts and OAuth providers all
// expose different size knobs; we collapse them into a single
// `highResAvatarUrl(url, sizePx)` call so consumers don't have to know
// which CDN they're talking to. Default size of 128 px covers any
// avatar rendered up to ~64 px on a 2x retina display without
// pixelation.

const DEFAULT_SIZE = 128;

/**
 * Rewrite an avatar URL to request a target render size from the
 * upstream image host. Returns the original URL unchanged when the
 * host isn't recognised — callers should still pass it through so
 * the rendering path stays consistent.
 */
export function highResAvatarUrl(url: string | null | undefined, targetPx: number = DEFAULT_SIZE): string | null {
  if (!url) return null;

  // Supabase Storage transforms: the public-object URL has the form
  //   .../storage/v1/object/public/<bucket>/<path>
  // Swap "object" for "render/image" and add resize params to get a
  // resized variant served from the storage CDN.
  if (/\/storage\/v1\/object\/(public|sign|authenticated)\//.test(url)) {
    const rendered = url.replace('/storage/v1/object/', '/storage/v1/render/image/');
    const separator = rendered.includes('?') ? '&' : '?';
    return `${rendered}${separator}width=${targetPx}&height=${targetPx}&resize=cover&quality=80`;
  }

  // Google profile pictures (OAuth) end in `=s<size>-c` or `=s<size>`
  // for the size hint. `=s96-c` is the legacy default we usually get;
  // bump it to the target so the 28 px header circle has 4x source
  // pixels on a 2x display.
  if (/googleusercontent\.com\//.test(url)) {
    return url.replace(/=s\d+(-c)?$/, `=s${targetPx}$1`);
  }

  // Cloudinary: insert a transformation segment after `/upload/`.
  // `c_fill` crops to the target box; `q_auto,f_auto` lets Cloudinary
  // pick the best encoding for the requesting browser.
  if (/res\.cloudinary\.com\//.test(url) && url.includes('/upload/')) {
    return url.replace('/upload/', `/upload/w_${targetPx},h_${targetPx},c_fill,q_auto,f_auto/`);
  }

  // Gravatar: ?s=<size>
  if (/gravatar\.com\/avatar\//.test(url)) {
    return url.includes('?')
      ? `${url}&s=${targetPx}`
      : `${url}?s=${targetPx}`;
  }

  return url;
}
