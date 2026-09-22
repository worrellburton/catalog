// Who a look's creator is, for the look page's creator strip: the display
// name and avatar (creators row, then the owner's profile) plus their
// Instagram / TikTok handles (profile only). One small lookup per handle,
// cached for the session.

// imports
import { supabase } from '~/utils/supabase';

// types
export interface CreatorIdentity {
  displayName: string | null;
  avatarUrl: string | null;
  instagram: string | null;
  tiktok: string | null;
}

// constants
const cache = new Map<string, Promise<CreatorIdentity>>();

// helpers
type ProfileRow = { full_name: string | null; avatar_url: string | null; instagram_handle: string | null; tiktok_handle: string | null };
type CreatorRow = { display_name: string | null; avatar_url: string | null };

async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  const { data } = await supabase!
    .from('profiles')
    .select('full_name, avatar_url, instagram_handle, tiktok_handle')
    .eq('id', userId)
    .maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

async function load(handle: string): Promise<CreatorIdentity> {
  const empty: CreatorIdentity = { displayName: null, avatarUrl: null, instagram: null, tiktok: null };
  if (!supabase || !handle) return empty;
  // user:<uuid> creators have no creators row — the profile is the identity.
  if (handle.startsWith('user:')) {
    const p = await fetchProfile(handle.slice(5));
    return p
      ? { displayName: p.full_name, avatarUrl: p.avatar_url, instagram: p.instagram_handle, tiktok: p.tiktok_handle }
      : empty;
  }
  const [creatorRes, ownerRes] = await Promise.all([
    supabase.from('creators').select('display_name, avatar_url').eq('handle', handle).maybeSingle(),
    supabase.from('looks').select('user_id').eq('creator_handle', handle).not('user_id', 'is', null).limit(1),
  ]);
  const creator = (creatorRes.data as CreatorRow | null) ?? null;
  const ownerId = ((ownerRes.data as { user_id: string | null }[] | null) ?? [])[0]?.user_id ?? null;
  const profile = ownerId ? await fetchProfile(ownerId) : null;
  return {
    displayName: profile?.full_name || creator?.display_name || null,
    avatarUrl: profile?.avatar_url || creator?.avatar_url || null,
    instagram: profile?.instagram_handle ?? null,
    tiktok: profile?.tiktok_handle ?? null,
  };
}

// main logic
export function getCreatorIdentity(handle: string): Promise<CreatorIdentity> {
  let p = cache.get(handle);
  if (!p) {
    p = load(handle).catch(() => ({ displayName: null, avatarUrl: null, instagram: null, tiktok: null }));
    cache.set(handle, p);
  }
  return p;
}
