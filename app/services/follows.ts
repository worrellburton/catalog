/**
 * Creator follow relationships. Backed by `public.creator_follows`
 * (migration 20260526000001).
 *
 * Keyed by handle (not user_id) so seed creators that don't have a
 * profiles row can still be followed. Pure RLS — every read/write
 * scopes to the signed-in user via auth.uid().
 */

import { supabase } from '~/utils/supabase';

/** Toggle follow state for the signed-in shopper. Returns the new
 *  follow state (true = following) so callers can update UI without
 *  refetching. No-ops + returns the previous state if Supabase isn't
 *  configured or the user isn't signed in. */
export async function toggleFollow(handle: string): Promise<{ following: boolean }> {
  if (!supabase) return { following: false };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { following: false };

  const { count } = await supabase
    .from('creator_follows')
    .select('follower_id', { count: 'exact', head: true })
    .eq('follower_id', user.id)
    .eq('followee_handle', handle);

  if ((count ?? 0) > 0) {
    // Unfollow
    await supabase
      .from('creator_follows')
      .delete()
      .eq('follower_id', user.id)
      .eq('followee_handle', handle);
    return { following: false };
  }
  // Follow
  await supabase
    .from('creator_follows')
    .upsert({ follower_id: user.id, followee_handle: handle }, { onConflict: 'follower_id,followee_handle' });
  return { following: true };
}

/** Does the signed-in shopper follow this creator? false when
 *  signed-out (so the FOLLOW button reads "Follow" not "Following"). */
export async function isFollowing(handle: string): Promise<boolean> {
  if (!supabase) return false;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { count } = await supabase
    .from('creator_follows')
    .select('follower_id', { count: 'exact', head: true })
    .eq('follower_id', user.id)
    .eq('followee_handle', handle);
  return (count ?? 0) > 0;
}

/** Live follower count for the creator badge. */
export async function getFollowerCount(handle: string): Promise<number> {
  if (!supabase) return 0;
  const { count } = await supabase
    .from('creator_follows')
    .select('follower_id', { count: 'exact', head: true })
    .eq('followee_handle', handle);
  return count ?? 0;
}

/** All creators the signed-in shopper follows, most recent first. */
export async function getMyFollowing(): Promise<string[]> {
  if (!supabase) return [];
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from('creator_follows')
    .select('followee_handle, created_at')
    .eq('follower_id', user.id)
    .order('created_at', { ascending: false });
  return ((data || []) as { followee_handle: string }[]).map(r => r.followee_handle);
}
