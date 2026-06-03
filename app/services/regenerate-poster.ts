import { supabase } from '~/utils/supabase';

// Modal endpoint that extracts a product's primary-video hero frame and
// writes products.primary_video_poster_url. Same URL the
// trg_products_generate_primary_poster DB trigger fires (public, no auth) —
// defaulted here so the admin Regenerate button works out of the box, and
// overridable per environment.
const MODAL_POSTER_URL =
  import.meta.env.VITE_MODAL_POSTER_URL || 'https://catalog--generate-primary-poster.modal.run';

const SUBMIT_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 150_000;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export class PosterRegenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PosterRegenError';
  }
}

/**
 * Re-run the Modal primary-poster job for a single product and resolve once
 * the fresh poster has landed.
 *
 * The job writes to a deterministic storage key, so primary_video_poster_url
 * keeps the same URL — only the bytes change. We can't detect completion by a
 * URL diff, so we null the column first (which also satisfies the webhook's
 * "poster already set" skip-guard) and poll until it flips back to non-null.
 * Nulling can't re-fire the trigger — it only watches primary_video_url.
 *
 * The fetch is best-effort: a CORS/opaque rejection still means Modal received
 * the POST, so we swallow fetch errors and let the DB poll decide success.
 *
 * @returns the poster URL with a cache-busting param so an <img> reloads it.
 */
export async function regeneratePrimaryPoster(
  productId: string,
  primaryVideoUrl: string | null,
  previousPosterUrl: string | null,
): Promise<string> {
  if (!supabase) throw new PosterRegenError('Supabase not configured.');
  if (!primaryVideoUrl) {
    throw new PosterRegenError('This product has no primary video to extract a poster from.');
  }

  // Clear the current poster so the job re-renders and completion is detectable.
  const { error: clearErr } = await supabase
    .from('products')
    .update({ primary_video_poster_url: null })
    .eq('id', productId);
  if (clearErr) throw new PosterRegenError(`Could not clear the current poster: ${clearErr.message}`);

  // Kick the Modal job.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SUBMIT_TIMEOUT_MS);
  try {
    await fetch(MODAL_POSTER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        record: {
          id: productId,
          primary_video_url: primaryVideoUrl,
          primary_video_poster_url: null,
        },
      }),
      signal: ctrl.signal,
    });
  } catch {
    /* swallowed — a CORS/network rejection doesn't mean Modal missed the POST */
  } finally {
    clearTimeout(timer);
  }

  // Poll until the job writes a fresh poster URL back.
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const { data } = await supabase
      .from('products')
      .select('primary_video_poster_url')
      .eq('id', productId)
      .single();
    const next = (data as { primary_video_poster_url: string | null } | null)?.primary_video_poster_url ?? null;
    if (next) return `${next}${next.includes('?') ? '&' : '?'}rb=${Date.now()}`;
  }

  // Timed out — restore the prior poster so the feed isn't left posterless.
  if (previousPosterUrl) {
    await supabase
      .from('products')
      .update({ primary_video_poster_url: previousPosterUrl })
      .eq('id', productId);
  }
  throw new PosterRegenError(
    'Poster job didn’t finish in time — it may still complete shortly. The previous poster was restored.',
  );
}
