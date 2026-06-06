// Background backfill: give every look a poster image.
//
// Looks render poster-first (LookCard paints looks_creative.thumbnail_url
// before/behind the video), but a chunk of looks have no poster — their
// primary creative's thumbnail_url is null — so they show as a blank grey
// card (e.g. on the Saved screen). Posters are generated client-side by
// capturing a video frame and uploading it to the look-media bucket
// (utils/video-poster). There's no server/CDN shortcut (fal.media doesn't
// serve a thumbnail), so we backfill from the browser.
//
// This runs once per session, sequentially + throttled, for a caller that
// has write access (admins). Each look's video is loaded off-screen, a
// frame is captured, stored, and the creative's thumbnail_url is set —
// after which that look paints its poster everywhere.

import { supabase } from '~/utils/supabase';
import { generateAndStorePoster } from '~/utils/video-poster';

let started = false;

interface CreativeRow {
  id: string;
  look_id: string;
  video_url: string | null;
}

/**
 * Find primary look creatives that have a video but no poster, and generate
 * one for each. Idempotent per session (the `started` guard) and best-effort
 * — any failure (RLS, decode, CORS) is swallowed so it never disrupts the
 * page. Returns the number of posters successfully generated.
 */
export async function backfillMissingLookPosters(max = 40): Promise<number> {
  if (started || typeof window === 'undefined' || !supabase) return 0;
  started = true;

  const { data, error } = await supabase
    .from('looks_creative')
    .select('id, look_id, video_url')
    .eq('is_primary', true)
    .is('thumbnail_url', null)
    .not('video_url', 'is', null)
    .limit(max);
  if (error || !data || data.length === 0) return 0;

  let done = 0;
  // Sequential: each call mounts an off-screen <video> and decodes a frame,
  // so we never run more than one at a time.
  for (const row of data as CreativeRow[]) {
    if (!row.video_url) continue;
    try {
      const url = await generateAndStorePoster(row.look_id, row.id, row.video_url);
      if (url) done++;
    } catch {
      /* best-effort — skip and continue */
    }
  }
  return done;
}
