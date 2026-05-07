// Public-share helpers for an exported user_generation. The Export
// button on the result page calls createLookShare to mint the row +
// kick off the Modal watermark worker; pollLookShare watches for the
// watermarked_video_url to appear so the share modal can surface
// "ready" vs "still rendering" cleanly.

import { supabase } from '~/utils/supabase';

export interface LookShare {
  id: string;
  slug: string;
  generation_id: string;
  created_by: string;
  watermarked_video_url: string | null;
  watermarked_storage_path: string | null;
  status: 'pending' | 'rendering' | 'done' | 'failed';
  error: string | null;
  created_at: string;
  rendered_at: string | null;
}

interface CreateLookShareResponse {
  share_id: string;
  slug: string;
  status: LookShare['status'];
  watermarked_video_url?: string | null;
  reused?: boolean;
  modal?: 'queued' | 'missing_url' | 'error';
  error?: string;
}

/** Mint (or re-use) a public share for the given generation. Calls
 *  the share-look edge function which:
 *    1. Verifies caller owns the generation
 *    2. Reuses an existing share row when one already exists
 *    3. Inserts a new look_shares row with a unique slug
 *    4. Triggers the Modal watermark worker
 *  Returns the slug + share id. The watermarked URL lands later,
 *  surfaced via getLookShare polling. */
export async function createLookShare(
  generationId: string,
): Promise<CreateLookShareResponse> {
  if (!supabase) return { share_id: '', slug: '', status: 'failed', error: 'Supabase not configured' };
  const { data, error } = await supabase.functions.invoke<CreateLookShareResponse>(
    'share-look',
    { body: { generation_id: generationId } },
  );
  if (error) {
    return { share_id: '', slug: '', status: 'failed', error: error.message };
  }
  if (!data) {
    return { share_id: '', slug: '', status: 'failed', error: 'empty response' };
  }
  return data;
}

/** Read a share row by id. Used by the Export modal to poll for the
 *  watermarked URL. */
export async function getLookShare(shareId: string): Promise<LookShare | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('look_shares')
    .select('*')
    .eq('id', shareId)
    .maybeSingle();
  return (data as LookShare | null) ?? null;
}

/** Read a share row by slug. Used by the public /s/:slug page. RLS
 *  allows anonymous select, so this works with the anon key. */
export async function getLookShareBySlug(slug: string): Promise<LookShare | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('look_shares')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  return (data as LookShare | null) ?? null;
}

/** Build the public-facing share URL for a slug. Uses
 *  window.location.origin so dev/staging/prod all resolve correctly
 *  without an env var. */
export function shareUrlFor(slug: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/s/${slug}`;
}
