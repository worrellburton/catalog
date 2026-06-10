// Creator "about" blurb — a short Claude-generated description of a
// creator's aesthetic, shown on the look overlay's About tab. The blurb is
// cached server-side in creator_about_summaries; this module reads that
// cache directly (public-readable, so it works for logged-out viewers) and
// falls back to the `creator-about` edge function to generate one on demand
// for signed-in viewers.

import { supabase } from '~/utils/supabase';

export interface CreatorAboutLook {
  title?: string | null;
  brands?: string[] | null;
  types?: string[] | null;
}

/** Read a cached blurb without triggering generation. Returns null when
 *  none exists yet (or Supabase isn't configured). */
export async function getCachedCreatorAbout(handle: string): Promise<string | null> {
  if (!supabase || !handle) return null;
  const { data } = await supabase
    .from('creator_about_summaries')
    .select('summary')
    .eq('handle', handle)
    .maybeSingle();
  return (data?.summary as string | undefined) || null;
}

/** Generate (and cache) a blurb via the edge function. Generation is
 *  auth-gated, so this no-ops for logged-out viewers. */
export async function generateCreatorAbout(
  handle: string,
  displayName: string,
  looks: CreatorAboutLook[],
): Promise<string | null> {
  if (!supabase || !handle || looks.length === 0) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase.functions.invoke('creator-about', {
    body: { handle, displayName, looks },
  });
  if (error) return null;
  return (data?.summary as string | undefined) || null;
}

/** Cache-first resolve: return the cached blurb if present, otherwise try
 *  to generate one (signed-in only). */
export async function getCreatorAbout(
  handle: string,
  displayName: string,
  looks: CreatorAboutLook[],
): Promise<string | null> {
  const cached = await getCachedCreatorAbout(handle);
  if (cached) return cached;
  return generateCreatorAbout(handle, displayName, looks);
}
