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

  // No self-follows: a creator's own handle is `user:<their id>`. Guard here
  // so a stray tap can never create the self-follow row.
  if (handle === `user:${user.id}`) return { following: false };

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

/** How many creators a given user follows — for the creator-hero stats.
 *  Counts creator_follows rows authored by this user (follower_id). */
export async function getFollowingCount(userId: string): Promise<number> {
  if (!supabase || !userId) return 0;
  const { count } = await supabase
    .from('creator_follows')
    .select('followee_handle', { count: 'exact', head: true })
    .eq('follower_id', userId);
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

/** A user shown in a followers / following list — enough to render a row and
 *  open their catalog (via the `catalog:open-creator` event with `handle`). */
export interface FollowUser {
  /** Handle to open their catalog: `user:<id>` for shoppers, or a creator handle. */
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Everyone who follows this creator (handle), newest first. Each follower is a
 *  signed-in user, so we resolve their profile and hand back a `user:<id>`
 *  handle that opens their own catalog. */
export async function getFollowers(handle: string): Promise<FollowUser[]> {
  if (!supabase || !handle) return [];
  const { data } = await supabase
    .from('creator_follows')
    .select('follower_id, created_at')
    .eq('followee_handle', handle)
    .order('created_at', { ascending: false });
  const ids = [...new Set(((data || []) as { follower_id: string }[]).map(r => r.follower_id))];
  if (ids.length === 0) return [];
  const { data: profs } = await supabase
    .from('profiles')
    .select('id, full_name, email, avatar_url')
    .in('id', ids);
  const byId = new Map(
    ((profs || []) as { id: string; full_name: string | null; email: string | null; avatar_url: string | null }[])
      .map(p => [p.id, p]),
  );
  return ids.map(id => {
    const p = byId.get(id);
    return {
      handle: `user:${id}`,
      displayName: p?.full_name || p?.email?.split('@')[0] || 'Shopper',
      avatarUrl: p?.avatar_url || null,
    };
  });
}

/** Every creator a given user follows, newest first. followee_handle is either
 *  `user:<uuid>` (resolve via profiles) or a plain creator handle (resolve via
 *  the creators table); either way the handle opens their catalog. */
export async function getFollowing(userId: string): Promise<FollowUser[]> {
  if (!supabase || !userId) return [];
  const { data } = await supabase
    .from('creator_follows')
    .select('followee_handle, created_at')
    .eq('follower_id', userId)
    .order('created_at', { ascending: false });
  const handles = [...new Set(((data || []) as { followee_handle: string }[]).map(r => r.followee_handle))];
  if (handles.length === 0) return [];

  const userIds = handles
    .filter(h => /^user:[0-9a-f-]{36}$/i.test(h))
    .map(h => h.slice(5));
  const plainHandles = handles.filter(h => !/^user:/.test(h));

  const [profsRes, creatorsRes] = await Promise.all([
    userIds.length
      ? supabase.from('profiles').select('id, full_name, email, avatar_url').in('id', userIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null; email: string | null; avatar_url: string | null }> }),
    plainHandles.length
      ? supabase.from('creators').select('handle, display_name, avatar_url').in('handle', plainHandles)
      : Promise.resolve({ data: [] as Array<{ handle: string; display_name: string | null; avatar_url: string | null }> }),
  ]);
  const profById = new Map(((profsRes.data || []) as Array<{ id: string; full_name: string | null; email: string | null; avatar_url: string | null }>).map(p => [p.id, p]));
  const creatorByHandle = new Map(((creatorsRes.data || []) as Array<{ handle: string; display_name: string | null; avatar_url: string | null }>).map(c => [c.handle, c]));

  return handles.map(h => {
    if (/^user:/.test(h)) {
      const p = profById.get(h.slice(5));
      return {
        handle: h,
        displayName: p?.full_name || p?.email?.split('@')[0] || 'Creator',
        avatarUrl: p?.avatar_url || null,
      };
    }
    const c = creatorByHandle.get(h);
    return { handle: h, displayName: c?.display_name || h, avatarUrl: c?.avatar_url || null };
  });
}

/** A creator the shopper follows, enriched with the stats the Following
 *  list-view page shows: how many looks they've posted, how many followers
 *  they have, when they last posted, and when you started following them. */
export interface FollowingDetail {
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  /** ms-since-epoch you started following this creator. */
  followedAt: number;
  looksCount: number;
  followerCount: number;
  /** ms-since-epoch of their most recent look, 0 if they've never posted. */
  lastPostTs: number;
}

/** Every creator the shopper follows, newest-followed first, each with
 *  display info + engagement stats for the Following page. One round of
 *  fan-out queries (creators / looks / follower counts), tallied client-side
 *  with a profiles fallback for seed creators that have no avatar yet. */
export async function getMyFollowingDetailed(): Promise<FollowingDetail[]> {
  if (!supabase) return [];
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: followRows } = await supabase
    .from('creator_follows')
    .select('followee_handle, created_at')
    .eq('follower_id', user.id)
    .order('created_at', { ascending: false });
  const rows = (followRows || []) as { followee_handle: string; created_at: string }[];
  if (rows.length === 0) return [];

  const handles = rows.map(r => r.followee_handle);
  const followedAtByHandle = new Map(
    rows.map(r => [r.followee_handle, Date.parse(r.created_at) || Date.now()] as const),
  );

  const [creatorsRes, looksRes, followersRes] = await Promise.all([
    supabase.from('creators').select('id, handle, display_name, avatar_url').in('handle', handles),
    supabase.from('looks').select('creator_handle, user_id, created_at').in('creator_handle', handles),
    supabase.from('creator_follows').select('followee_handle').in('followee_handle', handles),
  ]);

  type CRow = { id: string | null; handle: string; display_name: string | null; avatar_url: string | null };
  type LRow = { creator_handle: string; user_id: string | null; created_at: string | null };
  const creatorByHandle = new Map<string, CRow>(
    ((creatorsRes.data || []) as CRow[]).map(c => [c.handle, c]),
  );

  // Looks count + last-post ts + a representative user_id per handle.
  const looksCountByHandle = new Map<string, number>();
  const lastPostByHandle = new Map<string, number>();
  const userIdByHandle = new Map<string, string>();
  // A `user:<uuid>` handle carries the profile id inline — seed it
  // directly so the profiles fallback below can resolve a real name +
  // avatar even when the account has no looks (and thus no looks row to
  // derive the id from). Without this such accounts render as the raw
  // "user:63c0…" handle string in the following list + rail.
  for (const h of handles) {
    if (h.startsWith('user:')) userIdByHandle.set(h, h.slice(5));
  }
  for (const l of (looksRes.data || []) as LRow[]) {
    looksCountByHandle.set(l.creator_handle, (looksCountByHandle.get(l.creator_handle) ?? 0) + 1);
    if (l.user_id && !userIdByHandle.has(l.creator_handle)) userIdByHandle.set(l.creator_handle, l.user_id);
    if (l.created_at) {
      const ts = Date.parse(l.created_at);
      if (Number.isFinite(ts) && ts > (lastPostByHandle.get(l.creator_handle) ?? 0)) {
        lastPostByHandle.set(l.creator_handle, ts);
      }
    }
  }

  // Follower count per followed creator (tally the rows we can read).
  const followerCountByHandle = new Map<string, number>();
  for (const f of (followersRes.data || []) as { followee_handle: string }[]) {
    followerCountByHandle.set(f.followee_handle, (followerCountByHandle.get(f.followee_handle) ?? 0) + 1);
  }

  // Fetch the profile for every user-backed handle so the profile avatar can
  // win below (a real-user creator's creators row often holds a stale
  // signup-time avatar while the fresh one lives on their profile).
  const profileNeeded = Array.from(new Set(
    handles
      .map(h => userIdByHandle.get(h))
      .filter((u): u is string => !!u),
  ));
  const profileByUserId = new Map<string, { full_name: string | null; avatar_url: string | null }>();
  if (profileNeeded.length > 0) {
    const { data: profs } = await supabase
      .from('profiles').select('id, full_name, avatar_url').in('id', profileNeeded);
    for (const p of (profs || []) as { id: string; full_name: string | null; avatar_url: string | null }[]) {
      profileByUserId.set(p.id, { full_name: p.full_name, avatar_url: p.avatar_url });
    }
  }

  return handles.map(h => {
    const cr = creatorByHandle.get(h);
    const uid = userIdByHandle.get(h);
    const prof = uid ? profileByUserId.get(uid) : undefined;
    return {
      handle: h,
      displayName: cr?.display_name || prof?.full_name || null,
      // Profile avatar wins (fresh, user-controlled), then the creators row —
      // matches the creator catalog + following rail.
      avatarUrl: prof?.avatar_url || cr?.avatar_url || null,
      followedAt: followedAtByHandle.get(h) ?? Date.now(),
      looksCount: looksCountByHandle.get(h) ?? 0,
      followerCount: followerCountByHandle.get(h) ?? 0,
      lastPostTs: lastPostByHandle.get(h) ?? 0,
    };
  });
}

/** People who follow the signed-in shopper — most recent first.
 *  Returns the follower's display name, avatar, and the ms-timestamp
 *  of when they followed (so the rail can render a "followed Xs ago"
 *  tooltip and animate brand-new followers).
 *
 *  Requires the signed-in user to have a `creators.handle` row —
 *  nobody can follow a handle-less account, so we'd return an empty
 *  list either way. */
export interface FollowerInfo {
  handle: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  followedAt: number;
}

export async function getMyFollowers(): Promise<FollowerInfo[]> {
  if (!supabase) return [];
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: meCreator } = await supabase
    .from('creators').select('handle').eq('id', user.id).maybeSingle();
  const myHandle = meCreator?.handle;
  if (!myHandle) return [];

  const { data: followRows } = await supabase
    .from('creator_follows')
    .select('follower_id, created_at')
    .eq('followee_handle', myHandle)
    .order('created_at', { ascending: false });
  if (!followRows?.length) return [];

  const followerIds = (followRows as { follower_id: string }[]).map(r => r.follower_id);

  const [{ data: profs }, { data: crows }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, avatar_url').in('id', followerIds),
    supabase.from('creators').select('id, handle, display_name, avatar_url').in('id', followerIds),
  ]);
  const profById = new Map<string, { full_name: string | null; avatar_url: string | null }>(
    ((profs || []) as { id: string; full_name: string | null; avatar_url: string | null }[]).map(p => [p.id, p]),
  );
  const creatorById = new Map<string, { handle: string; display_name: string | null; avatar_url: string | null }>(
    ((crows || []) as { id: string; handle: string; display_name: string | null; avatar_url: string | null }[]).map(c => [c.id, c]),
  );

  return (followRows as { follower_id: string; created_at: string }[]).map(r => {
    const c = creatorById.get(r.follower_id);
    const p = profById.get(r.follower_id);
    return {
      handle: c?.handle || `user:${r.follower_id}`,
      userId: r.follower_id,
      displayName: c?.display_name || p?.full_name || null,
      avatarUrl: c?.avatar_url || p?.avatar_url || null,
      followedAt: Date.parse(r.created_at) || Date.now(),
    };
  });
}

// ── Suggested creators (cold-start fallback for FollowingRail) ────────
//
// When a user hasn't followed anyone yet, the stories rail used to render
// empty space — bad first impression for a discovery surface. Instead we
// show "popular creators of your gender" as a default: real creators with
// real avatars and recent posts, ranked by lifetime look count. Once the
// user follows their first creator the rail switches to their follows
// (FollowingRail handles the swap at the consumer site).
//
// "Popular by gender" is computed from the creator's own profile.gender
// (per-creator) rather than per-look, because the gender column on
// individual looks is auto-synced from the creator's profile (see
// migration `looks_gender_sync_from_profile`) so they're equivalent and
// the per-profile query is cheaper.

export interface SuggestedCreator {
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  /** Lookcount used as the popularity proxy — also stuffed into the
   *  RailEntry.ts slot so the existing "newest-post-first" sort gives
   *  the rail a coherent order without a second query. */
  lookCount: number;
}

export async function getPopularCreators(
  gender: 'male' | 'female' | 'unknown',
  opts: { limit?: number; excludeHandles?: string[] } = {},
): Promise<SuggestedCreator[]> {
  if (!supabase) return [];
  const limit = opts.limit ?? 12;
  const exclude = new Set((opts.excludeHandles ?? []).map(h => h.toLowerCase()));

  // 1. Pick creator profiles to consider. Try gender-scoped first;
  //    fall back to no-filter if the gender-scoped query returns 0 (a
  //    tiny corner of the catalog might have no profiles tagged with
  //    the shopper's gender — better to show ANY popular creators than
  //    an empty rail).
  type ProfileRow = { id: string; full_name: string | null; avatar_url: string | null; gender: string | null };
  const pullProfiles = async (withGender: boolean): Promise<ProfileRow[]> => {
    let q = supabase!
      .from('profiles')
      .select('id, full_name, avatar_url, gender')
      .not('full_name', 'is', null);
    if (withGender && (gender === 'male' || gender === 'female')) {
      q = q.in('gender', [gender, 'unisex']);
    }
    const { data } = await q.limit(200);
    return (data as ProfileRow[] | null) || [];
  };
  let profiles = await pullProfiles(true);
  if (profiles.length === 0 && (gender === 'male' || gender === 'female')) {
    profiles = await pullProfiles(false); // fall back: any gender
  }
  if (profiles.length === 0) return [];
  const profileById = new Map(profiles.map(p => [p.id, p]));

  // 2. Pull looks belonging to those creators, group by user_id to count
  //    lifetime posts + resolve their creator_handle. Cap the query at
  //    2k rows — that's enough to score even the top-1% of creators by
  //    look volume, and one round trip keeps this cold-start cheap.
  const { data: lookRows } = await supabase
    .from('looks')
    .select('user_id, creator_handle, created_at')
    .in('user_id', profiles.map(p => p.id))
    .eq('status', 'live')
    .eq('enabled', true)
    .is('archived_at', null)
    .not('creator_handle', 'is', null)
    .order('created_at', { ascending: false })
    .limit(2000);
  type LookRow = { user_id: string; creator_handle: string; created_at: string | null };
  const looks = (lookRows as LookRow[] | null) || [];
  if (looks.length === 0) {
    // Last-resort: even without any LIVE looks to score, surface the
    // candidate profiles themselves as suggested creators so the rail
    // isn't empty. Better to show real creators with no look count than
    // a blank rail on first open.
    return profiles.slice(0, limit).map(p => ({
      handle: (p.full_name || '').toLowerCase().replace(/[^a-z0-9]+/g, '') || p.id.slice(0, 8),
      displayName: p.full_name,
      avatarUrl: p.avatar_url,
      lookCount: 0,
    }));
  }

  // 3. Score per creator. Handle uniqueness is the de-dup key (a single
  //    creator might have multiple profile rows historically).
  type Agg = { handle: string; lookCount: number; latestTs: number; userId: string };
  const byHandle = new Map<string, Agg>();
  for (const l of looks) {
    const handle = l.creator_handle.toLowerCase();
    if (exclude.has(handle)) continue;
    const cur = byHandle.get(handle) || { handle: l.creator_handle, lookCount: 0, latestTs: 0, userId: l.user_id };
    cur.lookCount += 1;
    const ts = l.created_at ? Date.parse(l.created_at) : 0;
    if (ts > cur.latestTs) cur.latestTs = ts;
    byHandle.set(handle, cur);
  }
  if (byHandle.size === 0) return [];

  // 4. Pick the top-N by lookCount; for the avatar/displayName we prefer
  //    the creators table when present (it's the curated row) and fall
  //    back to the profile.
  const topAggs = Array.from(byHandle.values())
    // Only feature creators with a real catalog — four or more live looks.
    .filter(a => a.lookCount >= 4)
    .sort((a, b) => b.lookCount - a.lookCount || b.latestTs - a.latestTs)
    .slice(0, limit);
  if (topAggs.length === 0) return [];
  const handles = topAggs.map(a => a.handle);
  const { data: creatorRows } = await supabase
    .from('creators')
    .select('handle, display_name, avatar_url')
    .in('handle', handles);
  type CreatorRow = { handle: string; display_name: string | null; avatar_url: string | null };
  const creatorByHandle = new Map<string, CreatorRow>(
    ((creatorRows as CreatorRow[] | null) || []).map(c => [c.handle.toLowerCase(), c]),
  );

  return topAggs.map(a => {
    const cr = creatorByHandle.get(a.handle.toLowerCase());
    const pr = profileById.get(a.userId);
    return {
      handle: a.handle,
      displayName: cr?.display_name || pr?.full_name || null,
      avatarUrl: cr?.avatar_url || pr?.avatar_url || null,
      lookCount: a.lookCount,
    };
  });
}
