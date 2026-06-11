// Background backfill: give every look a poster that MATCHES its video.
//
// Looks render poster-first (the feed card paints looks_creative.thumbnail_url
// before/behind the video). Two cases break that:
//
//   1. thumbnail_url is null — the look shows a blank grey card (e.g. on the
//      Saved screen).
//   2. thumbnail_url points at the Modal-generated `creative/poster.jpg`, which
//      crops the first frame to 3:4. Look videos are 9:16, so that 3:4 crop
//      doesn't line up with the 9:16 video's center cover-crop in the tile —
//      poster→video visibly zooms/shifts. (Products don't have this: their
//      video is natively 3:4, so a 3:4 frame-0 poster matches.)
//
// Both are fixed the same way: capture the video's first frame at its NATIVE
// aspect (utils/video-poster keeps the source ratio) and upload it to
// `looks/<id>/poster.jpg`, then re-point thumbnail_url. object-fit:cover then
// crops that native-aspect poster identically to the <video> → no zoom. There's
// no server/CDN shortcut (fal.media doesn't serve a thumbnail), so we backfill
// from the browser. generateAndStorePoster writes a fresh poster.jpg and leaves
// the old creative/poster.jpg in storage, so the reconcile is reversible.
//
// This runs once per session, sequentially + throttled, for a caller that
// has write access (admins). Each look's video is loaded off-screen, a
// frame is captured, stored, and the creative's thumbnail_url is set —
// after which that look paints its poster everywhere.

import { supabase } from '~/utils/supabase';
import { generateAndStorePoster } from '~/utils/video-poster';

// Concurrency guard only — NOT a permanent once-per-session lock. Re-runnable
// so it can fire from multiple surfaces (home feed + creator catalog) and
// retry looks whose extraction failed last time. The query already filters to
// still-missing posters, so resolved looks are never reprocessed.
let running = false;

interface CreativeRow {
  id: string;
  look_id: string;
  video_url: string | null;
}

// Matches the Modal generate-look-poster output (`…/looks/<id>/creative/poster.jpg`).
// Those are cropped to 3:4 and mismatch the 9:16 look video — regenerate them at
// native aspect. Kept loose (LIKE) so a `?v=N` cache-bust suffix still matches.
const MODAL_CREATIVE_POSTER_LIKE = '%/creative/poster%';

/**
 * Find primary look creatives whose poster is missing OR is the 3:4
 * Modal-cropped `creative/poster.jpg`, and (re)generate a native-aspect
 * first-frame poster for each so poster and video share the same crop.
 * Idempotent (the regenerated `poster.jpg` URL no longer matches either
 * filter) and best-effort — any failure (RLS, decode, CORS) is swallowed so it
 * never disrupts the page. Returns the number of posters successfully written.
 */
export async function backfillMissingLookPosters(max = 250): Promise<number> {
  if (running || typeof window === 'undefined' || !supabase) return 0;
  running = true;
  try {
  // Two passes: posterless looks (blank cards) + looks on the 3:4 Modal poster
  // (zoom on poster→video). Both need a native-aspect first-frame poster.
  const [missing, modal3x4] = await Promise.all([
    supabase
      .from('looks_creative')
      .select('id, look_id, video_url')
      .eq('is_primary', true)
      .is('thumbnail_url', null)
      .not('video_url', 'is', null)
      .limit(max),
    supabase
      .from('looks_creative')
      .select('id, look_id, video_url')
      .eq('is_primary', true)
      .like('thumbnail_url', MODAL_CREATIVE_POSTER_LIKE)
      .not('video_url', 'is', null)
      .limit(max),
  ]);
  if (missing.error && modal3x4.error) return 0;

  // Dedupe by creative id (the two filters are mutually exclusive today, but
  // guard against overlap so a look is never decoded twice).
  const byId = new Map<string, CreativeRow>();
  for (const r of [...(missing.data ?? []), ...(modal3x4.data ?? [])] as CreativeRow[]) {
    if (r.video_url) byId.set(r.id, r);
  }
  const rows = Array.from(byId.values());
  if (rows.length === 0) return 0;
  let done = 0;
  let next = 0;

  // Bounded concurrency: each task mounts an off-screen <video> and decodes a
  // frame (~1-2s). Fully sequential meant 30+ looks took a minute and admins
  // navigated away before it finished, so most looks kept showing a product
  // packshot fallback instead of their own first frame. A small pool drains
  // the whole queue in seconds without flooding the network/decoder.
  const POOL = 4;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= rows.length) return;
      const row = rows[i];
      try {
        const url = await generateAndStorePoster(row.look_id, row.id, row.video_url!);
        if (url) done++;
      } catch {
        /* best-effort — skip and continue */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, rows.length) }, worker));
  return done;
  } finally {
    running = false;
  }
}
