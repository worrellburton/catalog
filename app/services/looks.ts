import { supabase } from '~/utils/supabase';
import type { Look, Product, Creator } from '~/data/looks';
import { looks as staticLooks, creators as staticCreators, searchSuggestions as staticSuggestions } from '~/data/looks';

// Flag to toggle between Supabase and static data
// Set to true once Supabase tables are populated
const USE_SUPABASE = true;

// ============================================
// Supabase fetchers
// ============================================

interface SupabaseLook {
  id: string;
  legacy_id: number | null;
  title: string;
  gender: 'men' | 'women' | 'unisex' | null;
  creator_handle: string | null;
  user_id: string | null;
  description: string | null;
  color: string | null;
  status: string | null;
  looks_creative: {
    video_url: string | null;
    thumbnail_url: string | null;
    is_primary: boolean;
  }[];
  look_products: {
    sort_order: number;
    products: {
      name: string;
      brand: string;
      price: string;
      url: string;
      image_url: string;
    };
  }[];
}

async function fetchLooksFromSupabase(): Promise<Look[]> {
  if (!supabase) return staticLooks;
  // Join the primary creative for each look - looks_creative supersedes the
  // old looks.video_path column. !inner drops looks that have no creative
  // row (matches the previous "must have video_path" guard).
  const { data, error } = await supabase
    .from('looks')
    .select(`
      id,
      legacy_id,
      title,
      gender,
      creator_handle,
      user_id,
      description,
      color,
      status,
      looks_creative!inner (
        video_url,
        thumbnail_url,
        is_primary
      ),
      look_products (
        sort_order,
        products (
          name,
          brand,
          price,
          url,
          image_url
        )
      )
    `)
    .eq('looks_creative.is_primary', true)
    .order('created_at', { ascending: false });

  if (error || !data) {
    console.warn('Supabase looks fetch failed, falling back to static:', error?.message);
    return staticLooks;
  }

  // Surface only live looks (or legacy seed rows with no status) whose primary
  // creative actually has a playable video_url.
  const liveLooks = (data as unknown as SupabaseLook[]).filter((row) => {
    const primary = row.looks_creative?.[0];
    return primary?.video_url && (!row.status || row.status === 'live');
  });

  // For looks without a creator_handle (user-published looks created
  // via the manage-looks edge fn - handle is null because the fn
  // doesn't accept it), pull the publisher's profile so the admin
  // table + consumer-facing surfaces have a name + avatar to render.
  //
  // Two sources for the right user_id, in order of trust:
  //  1. Older rows where manage-looks wrote user_id = admin's auth.uid()
  //     - those rows carry "Promoted from generation <uuid>" in their
  //     description. We resolve the generation's actual user_id from
  //     user_generations and use *that* for the profile lookup so the
  //     creator column reads as the creator (not the admin).
  //  2. New rows where the publish flow patches user_id to the
  //     creator's id directly (fall-through from row.user_id).
  const PROMOTED_RE = /Promoted from generation ([0-9a-f-]{36})/i;
  const generationIdToLookId = new Map<string, string>();
  for (const r of liveLooks) {
    if (!r.creator_handle && r.description) {
      const m = r.description.match(PROMOTED_RE);
      if (m) generationIdToLookId.set(m[1], r.id);
    }
  }
  const userIdByLookId = new Map<string, string>();
  if (generationIdToLookId.size > 0) {
    const genIds = Array.from(generationIdToLookId.keys());
    const { data: gens } = await supabase
      .from('user_generations')
      .select('id, user_id')
      .in('id', genIds);
    (gens || []).forEach((g: { id: string; user_id: string | null }) => {
      const lookId = generationIdToLookId.get(g.id);
      if (lookId && g.user_id) userIdByLookId.set(lookId, g.user_id);
    });
  }

  const orphanUserIds = Array.from(new Set(
    liveLooks
      .filter(r => !r.creator_handle)
      .map(r => userIdByLookId.get(r.id) || r.user_id)
      .filter((v): v is string => !!v),
  ));
  const profileById = new Map<string, { full_name: string | null; avatar_url: string | null; email: string | null }>();
  if (orphanUserIds.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, email')
      .in('id', orphanUserIds);
    (profs || []).forEach((p: { id: string; full_name: string | null; avatar_url: string | null; email: string | null }) => {
      profileById.set(p.id, { full_name: p.full_name, avatar_url: p.avatar_url, email: p.email });
    });
  }

  return liveLooks.map((row, index) => {
    const primary = row.looks_creative[0];
    const profileUserId = !row.creator_handle ? (userIdByLookId.get(row.id) || row.user_id) : undefined;
    const fallbackProfile = profileUserId ? profileById.get(profileUserId) : undefined;
    const fallbackName = fallbackProfile?.full_name || fallbackProfile?.email?.split('@')[0] || null;
    return {
      id: row.legacy_id ?? -(index + 1),
      uuid: row.id,
      title: row.title,
      video: primary.video_url || '',
      gender: (row.gender as 'men' | 'women') || 'women',
      // Synthetic key so the creators-map lookup misses cleanly and
      // the consumer falls back to creatorDisplayName / Avatar below.
      creator: row.creator_handle || (profileUserId ? `user:${profileUserId}` : ''),
      creatorDisplayName: fallbackName || undefined,
      creatorAvatar: fallbackProfile?.avatar_url || undefined,
      description: row.description || '',
      color: row.color || '#888',
      products: (row.look_products || [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((lp) => ({
          name: lp.products?.name || '',
          brand: lp.products?.brand || '',
          price: lp.products?.price || '',
          url: lp.products?.url || '',
          image: lp.products?.image_url,
        })),
    };
  });
}

async function fetchCreatorsFromSupabase(): Promise<Record<string, Creator>> {
  if (!supabase) return staticCreators;
  const { data, error } = await supabase
    .from('creators')
    .select('handle, display_name, avatar_url');

  if (error || !data) {
    console.warn('Supabase creators fetch failed, falling back to static:', error?.message);
    return staticCreators;
  }

  const map: Record<string, Creator> = {};
  for (const row of data) {
    map[row.handle] = {
      name: row.handle,
      displayName: row.display_name,
      avatar: row.avatar_url || '',
    };
  }
  return map;
}

async function fetchSearchSuggestionsFromSupabase(): Promise<string[]> {
  if (!supabase) return staticSuggestions;
  const { data, error } = await supabase
    .from('search_suggestions')
    .select('text')
    .order('sort_order');

  if (error || !data) {
    return staticSuggestions;
  }

  return data.map((row) => row.text);
}

// ============================================
// Public API - returns static or Supabase data
// ============================================

// Session-level promise cache. The consumer feed mounts ContinuousFeed,
// _index.tsx (for ProductPage's editorial grid), and CreatorPage in parallel
// - each used to fire its own Supabase round-trip for the same dataset.
// Sharing the in-flight promise collapses those into one network call and
// keeps re-mounts (bookmarks → main, overlay open → close) free.
let looksPromise: Promise<Look[]> | null = null;
let creatorsPromise: Promise<Record<string, Creator>> | null = null;
let suggestionsPromise: Promise<string[]> | null = null;

function cache<T>(slot: () => Promise<T>, clear: () => void): Promise<T> {
  // Drop the cached promise on rejection so the next caller can retry
  // instead of being stuck with a permanently failed result.
  return slot().catch(err => { clear(); throw err; });
}

export async function getLooks(): Promise<Look[]> {
  if (!USE_SUPABASE) return staticLooks;
  if (!looksPromise) {
    looksPromise = cache(fetchLooksFromSupabase, () => { looksPromise = null; });
  }
  return looksPromise;
}

export async function getCreators(): Promise<Record<string, Creator>> {
  if (!USE_SUPABASE) return staticCreators;
  if (!creatorsPromise) {
    creatorsPromise = cache(fetchCreatorsFromSupabase, () => { creatorsPromise = null; });
  }
  return creatorsPromise;
}

export async function getSearchSuggestions(): Promise<string[]> {
  if (!USE_SUPABASE) return staticSuggestions;
  if (!suggestionsPromise) {
    suggestionsPromise = cache(fetchSearchSuggestionsFromSupabase, () => { suggestionsPromise = null; });
  }
  return suggestionsPromise;
}

// Admin surfaces (Content page, etc.) call this after a mutation so the next
// consumer fetch returns fresh data instead of a stale cached promise.
export function invalidateLooksCache() {
  looksPromise = null;
  creatorsPromise = null;
  suggestionsPromise = null;
}

// Prime the looks + creators caches at module load time, before any React
// component mounts. The fetch starts as soon as the JS bundle parses,
// running in parallel with rendering instead of waiting for useEffect.
// Effectively gives us a Remix clientLoader benefit without needing to
// thread useLoaderData through every component that wants the data.
//
// Guarded to browser context only - tests and SSR paths skip it.
if (typeof window !== 'undefined' && USE_SUPABASE) {
  // Fire-and-forget; populates the singleton promises. Component callers
  // .then() on the same promises and get the result whenever the network
  // comes back, regardless of whether they mount before or after.
  void getLooks().catch(() => { /* surfaced again on the real caller */ });
  void getCreators().catch(() => { /* surfaced again on the real caller */ });
}
