import { supabase } from '~/utils/supabase';
import { registerLookTrim } from '~/utils/lookTrim';
import type { Look, Product, Creator } from '~/data/looks';
import { looks as staticLooks, creators as staticCreators, searchSuggestions as staticSuggestions } from '~/data/looks';

// Flag to toggle between Supabase and static data
// Set to true once Supabase tables are populated
const USE_SUPABASE = true;

// ============================================
// localStorage SWR cache (mirrors product-creative pattern)
// ============================================
const LOOKS_LS_KEY = 'catalog:looks-cache:v1';
const LOOKS_LS_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function readLooksFromStorage(): Look[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LOOKS_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt: number; rows: Look[] };
    if (!parsed || typeof parsed.savedAt !== 'number' || !Array.isArray(parsed.rows)) return null;
    if (Date.now() - parsed.savedAt > LOOKS_LS_MAX_AGE_MS) return null;
    return parsed.rows;
  } catch {
    return null;
  }
}

function writeLooksToStorage(rows: Look[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOOKS_LS_KEY, JSON.stringify({ savedAt: Date.now(), rows }));
  } catch { /* quota exceeded - feed still works, just no fast-path next time */ }
}

export function getCachedLooks(): Look[] | null {
  return readLooksFromStorage();
}

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
  feed_rank: number | null;
  looks_creative: {
    video_url: string | null;
    thumbnail_url: string | null;
    mobile_video_url: string | null;
    is_primary: boolean;
    trim_start: number | null;
    trim_end: number | null;
  }[];
  look_products: {
    sort_order: number;
    products: {
      name: string;
      brand: string;
      price: string;
      url: string;
      image_url: string;
      primary_image_url: string | null;
      primary_video_url: string | null;
      primary_video_poster_url: string | null;
      type: string | null;
      subtype: string | null;
    };
  }[];
}

// Stable synthetic id for DB looks that have no legacy_id (every DB-native
// look today). Derived deterministically from the uuid so it never changes
// across fetches. The old `-(index + 1)` reshuffled on every load, which
// silently broke everything keyed on look.id — bookmarks, seen-state, admin
// hides (a stored hide matched a different look next fetch). Negative space
// keeps these clear of the positive ids carried by legacy seed looks; the
// magnitude stays modest so downstream id arithmetic (e.g. the `id * 1000`
// dedup in similar-look fill) stays well inside Number.MAX_SAFE_INTEGER.
function stableLookId(uuid: string): number {
  let h = 0;
  for (let i = 0; i < uuid.length; i++) {
    h = (Math.imul(h, 31) + uuid.charCodeAt(i)) | 0;
  }
  return -((Math.abs(h) % 2_000_000_000) + 1);
}

// Disambiguate looks that would render an identical title. Titles are
// auto-generated as "<creator>'s <style> look", so a creator with two
// cinematic looks produces two cards labelled identically — they read as
// duplicates even though each is a distinct video with its own products.
// This is purely cosmetic (no DB write): the first keeps the bare title,
// later collisions get a " 2", " 3" … suffix in stable feed order.
function disambiguateTitles(looks: Look[]): void {
  const seen = new Map<string, number>();
  for (const l of looks) {
    const base = (l.title || '').trim();
    if (!base) continue;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    if (n > 1) l.title = `${base} ${n}`;
  }
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
      feed_rank,
      looks_creative!inner (
        video_url,
        thumbnail_url,
        mobile_video_url,
        is_primary,
        trim_start,
        trim_end
      ),
      look_products (
        sort_order,
        products (
          name,
          brand,
          price,
          url,
          image_url,
          primary_image_url,
          primary_video_url,
          primary_video_poster_url,
          type,
          subtype
        )
      )
    `)
    .eq('looks_creative.is_primary', true)
    // Admin catalog order first (feed_rank), then newest.
    .order('feed_rank', { ascending: true, nullsFirst: false })
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

  // Forward-rule: every visible look must back-resolve to a real
  // entity in our DB. Either:
  //   - the `creator_handle` exists in the `creators` table, OR
  //   - the `user_id` exists in `profiles`.
  // Anything else (legacy seed rows whose creator only existed in
  // `app/data/looks.ts`, mis-imported handles, etc.) gets dropped so
  // the consumer feed never renders a look whose attribution is
  // fabricated. The two reference sets are tiny relative to the look
  // count so a single round trip per fetch is fine.
  const candidateHandles = Array.from(new Set(
    liveLooks.map(r => r.creator_handle).filter((h): h is string => !!h),
  ));
  const candidateUserIds = Array.from(new Set(
    liveLooks.map(r => r.user_id).filter((u): u is string => !!u),
  ));
  // Run the two validation lookups in parallel — they're independent
  // and were the serial bottleneck on every page load.
  const [creatorsByHandle, profilesById_validation] = await Promise.all([
    candidateHandles.length === 0
      ? Promise.resolve({ data: [] as Array<{ handle: string; is_ai: boolean | null; display_name: string | null; avatar_url: string | null }> })
      : supabase.from('creators').select('handle, is_ai, display_name, avatar_url').in('handle', candidateHandles),
    candidateUserIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ id: string }> })
      : supabase.from('profiles').select('id').in('id', candidateUserIds),
  ]);
  const knownHandles = new Set<string>();
  const knownUserIds = new Set<string>();
  // Reuse the creators payload for is_ai resolution below — saves the
  // separate handle-only query we used to do further down.
  const isAiByHandle = new Map<string, boolean>();
  const creatorDisplayByHandle = new Map<string, string | null>();
  const creatorAvatarByHandle = new Map<string, string | null>();
  (creatorsByHandle.data || []).forEach((r: { handle: string; is_ai: boolean | null; display_name: string | null; avatar_url: string | null }) => {
    knownHandles.add(r.handle);
    isAiByHandle.set(r.handle, r.is_ai === true);
    creatorDisplayByHandle.set(r.handle, r.display_name ?? null);
    creatorAvatarByHandle.set(r.handle, r.avatar_url ?? null);
  });
  (profilesById_validation.data || []).forEach((r: { id: string }) => knownUserIds.add(r.id));
  const filteredLooks = liveLooks.filter(r => {
    if (r.creator_handle && knownHandles.has(r.creator_handle)) return true;
    if (r.user_id && knownUserIds.has(r.user_id)) return true;
    return false;
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
  for (const r of filteredLooks) {
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

  // Fetch profile (avatar + name + is_ai) for EVERY look's user_id,
  // not just the handle-less orphans. The admin tables show creators
  // by handle most of the time, but the static creators map doesn't
  // cover every handle — without this lookup, real creators
  // (janehamilton, taylor-phillips, robert-burton, etc.) end up with
  // empty avatar placeholders in /admin/data.
  const profileUserIds = Array.from(new Set(
    filteredLooks
      .map(r => userIdByLookId.get(r.id) || r.user_id)
      .filter((v): v is string => !!v),
  ));
  const profileById = new Map<string, { full_name: string | null; avatar_url: string | null; email: string | null; is_ai: boolean }>();
  // Owner → canonical creator. creators.id === profiles.id (the auth user
  // id), so a user-published look (no creator_handle) whose owner IS a
  // creator can be normalized to that creator's handle — otherwise the same
  // person's looks split between a real handle and a synthetic user:<id>
  // key and render with different follow chips. See the bug where one
  // creator's cards looked inconsistent in the feed.
  const creatorByUserId = new Map<string, { handle: string; display_name: string | null; avatar_url: string | null; is_ai: boolean }>();
  if (profileUserIds.length > 0) {
    // profiles (avatar/name) and owner-creator normalization both key off the
    // same profileUserIds and populate independent maps — run them together
    // instead of back-to-back. These two were the tail of the look-enrichment
    // serial chain (looks → validate → user_generations → profiles → creators).
    const [profsRes, ownerRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, avatar_url, email, is_ai')
        .in('id', profileUserIds),
      supabase
        .from('creators')
        .select('id, handle, display_name, avatar_url, is_ai')
        .in('id', profileUserIds),
    ]);
    (profsRes.data || []).forEach((p: { id: string; full_name: string | null; avatar_url: string | null; email: string | null; is_ai: boolean | null }) => {
      profileById.set(p.id, { full_name: p.full_name, avatar_url: p.avatar_url, email: p.email, is_ai: p.is_ai === true });
    });
    (ownerRes.data || []).forEach((c: { id: string; handle: string; display_name: string | null; avatar_url: string | null; is_ai: boolean | null }) => {
      if (c.handle) creatorByUserId.set(c.id, { handle: c.handle, display_name: c.display_name, avatar_url: c.avatar_url, is_ai: c.is_ai === true });
    });
  }

  // is_ai by creator_handle was already populated above when we
  // queried creators for handle validation — single round trip.

  const result = filteredLooks.map((row) => {
    const primary = row.looks_creative[0];
    // Always look up profile by user_id when available — the avatar
    // belongs to the human/AI who owns this look, regardless of
    // whether creator_handle is set. The display-name fallback chain
    // (handle → static creator map → profile name) still respects
    // the handle as primary.
    const profileUserId = userIdByLookId.get(row.id) || row.user_id || undefined;
    const fallbackProfile = profileUserId ? profileById.get(profileUserId) : undefined;
    const fallbackName = fallbackProfile?.full_name || fallbackProfile?.email?.split('@')[0] || null;
    // Canonical creator for this look's owner (if they're a creator), used
    // to normalize handle-less / orphan looks onto one identity.
    const ownerCreator = profileUserId ? creatorByUserId.get(profileUserId) : undefined;
    return {
      id: row.legacy_id ?? stableLookId(row.id),
      uuid: row.id,
      feed_rank: row.feed_rank,
      title: row.title,
      video: primary.video_url || '',
      thumbnail_url: primary.thumbnail_url || undefined,
      mobile_video_url: primary.mobile_video_url || undefined,
      trimStart: primary.trim_start ?? undefined,
      trimEnd: primary.trim_end ?? undefined,
      gender: (row.gender as 'men' | 'women') || 'women',
      // Resolve creator identity. The CONTRACT we enforce: the chip's
      // displayed name and the routing key must point at the same
      // entity. The map lookup can fail two ways:
      //   1. handle has no row in the creators map at all
      //   2. handle has a row but its display_name column is null
      // Both cases make the chip's displayName fall back to the
      // look-owner's profile (fallbackName below). When THAT fallback
      // wins, the routing key MUST also fall back to the owner —
      // otherwise the chip says "Amir Malaklou" but the tap routes
      // to whatever string the wrong creator_handle was set to
      // (Ava Green, in the user's bug report). Using the resolved
      // display name (not just `.has()`) as the gate covers both
      // failure modes.
      creator: (() => {
        const mappedName = row.creator_handle
          ? creatorDisplayByHandle.get(row.creator_handle) ?? null
          : null;
        if (row.creator_handle && mappedName) {
          return row.creator_handle;
        }
        // Normalize: if the owner is a creator, use their canonical handle
        // so every one of their looks shares one identity + follow state.
        if (ownerCreator?.handle) return ownerCreator.handle;
        return profileUserId ? `user:${profileUserId}` : (row.creator_handle || '');
      })(),
      creatorDisplayName: (row.creator_handle ? (creatorDisplayByHandle.get(row.creator_handle) ?? null) : null) || ownerCreator?.display_name || fallbackName || undefined,
      creatorAvatar: (row.creator_handle ? (creatorAvatarByHandle.get(row.creator_handle) ?? null) : null) || ownerCreator?.avatar_url || fallbackProfile?.avatar_url || undefined,
      creatorIsAi: row.creator_handle
        ? (isAiByHandle.get(row.creator_handle) ?? false)
        : (ownerCreator?.is_ai ?? fallbackProfile?.is_ai ?? false),
      description: row.description || '',
      color: row.color || '#888',
      products: (row.look_products || [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((lp) => ({
          name: lp.products?.name || '',
          brand: lp.products?.brand || '',
          price: lp.products?.price || '',
          url: lp.products?.url || '',
          image: lp.products?.primary_image_url || lp.products?.image_url,
          // Surfacing the product's own polished video on the look-overlay
          // product list. LookOverlay renders ProductMiniMedia which starts
          // with the poster (image) and swaps to the muted+looping video
          // once it can play. Both fields are nullable — when missing the
          // poster image alone is shown.
          video_url: lp.products?.primary_video_url || undefined,
          thumbnail_url: lp.products?.primary_video_poster_url
            || lp.products?.primary_image_url
            || lp.products?.image_url
            || undefined,
          type: lp.products?.type ?? undefined,
          subtype: lp.products?.subtype ?? undefined,
        })),
    };
  });

  // Register trim windows so TrailVideoHost loops [start,end] for trimmed
  // looks (both the desktop + mobile video variants).
  for (const l of result) {
    if (l.trimStart != null || l.trimEnd != null) {
      registerLookTrim(l.video, l.trimStart, l.trimEnd);
      registerLookTrim(l.mobile_video_url, l.trimStart, l.trimEnd);
    }
  }

  // Make repeated auto-generated titles read as distinct cards (cosmetic).
  disambiguateTitles(result);

  writeLooksToStorage(result);
  return result;
}

// Fetch a single look by uuid REGARDLESS of status, so creator-facing
// surfaces (e.g. the activity "Your looks" rail) can open the look screen
// for an inactive/unpublished render that the public getLooks() filters out.
export async function getLookByUuid(uuid: string): Promise<Look | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('looks')
    .select(`
      id, legacy_id, title, gender, creator_handle, user_id, description, color, status, feed_rank,
      looks_creative ( video_url, thumbnail_url, mobile_video_url, is_primary, trim_start, trim_end ),
      look_products ( sort_order, products ( name, brand, price, url, image_url, primary_image_url, primary_video_url, primary_video_poster_url, type, subtype ) )
    `)
    .eq('id', uuid)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as SupabaseLook;
  const primary = (row.looks_creative || []).find(c => c.is_primary) ?? row.looks_creative?.[0];
  if (!primary?.video_url) return null;

  // Best-effort creator identity (name + avatar); the overlay falls back to
  // the handle if these are missing.
  let displayName: string | undefined;
  let avatar: string | undefined;
  let isAi = false;
  if (row.creator_handle) {
    const { data: c } = await supabase
      .from('creators').select('display_name, avatar_url, is_ai')
      .eq('handle', row.creator_handle).maybeSingle();
    const cr = c as { display_name: string | null; avatar_url: string | null; is_ai: boolean | null } | null;
    displayName = cr?.display_name ?? undefined;
    avatar = cr?.avatar_url ?? undefined;
    isAi = cr?.is_ai === true;
  }
  if ((!displayName || !avatar) && row.user_id) {
    const { data: p } = await supabase
      .from('profiles').select('full_name, avatar_url, email, is_ai')
      .eq('id', row.user_id).maybeSingle();
    const pr = p as { full_name: string | null; avatar_url: string | null; email: string | null; is_ai: boolean | null } | null;
    displayName = displayName || pr?.full_name || pr?.email?.split('@')[0] || undefined;
    avatar = avatar || pr?.avatar_url || undefined;
    isAi = isAi || pr?.is_ai === true;
  }

  if (primary.trim_start != null || primary.trim_end != null) {
    registerLookTrim(primary.video_url, primary.trim_start ?? undefined, primary.trim_end ?? undefined);
    registerLookTrim(primary.mobile_video_url ?? undefined, primary.trim_start ?? undefined, primary.trim_end ?? undefined);
  }

  return {
    id: row.legacy_id ?? stableLookId(row.id),
    uuid: row.id,
    feed_rank: row.feed_rank,
    title: row.title,
    video: primary.video_url || '',
    thumbnail_url: primary.thumbnail_url || undefined,
    mobile_video_url: primary.mobile_video_url || undefined,
    trimStart: primary.trim_start ?? undefined,
    trimEnd: primary.trim_end ?? undefined,
    gender: (row.gender as 'men' | 'women') || 'women',
    creator: row.creator_handle || (row.user_id ? `user:${row.user_id}` : ''),
    creatorDisplayName: displayName,
    creatorAvatar: avatar,
    creatorIsAi: isAi,
    description: row.description || '',
    color: row.color || '#888',
    products: (row.look_products || [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((lp) => ({
        name: lp.products?.name || '',
        brand: lp.products?.brand || '',
        price: lp.products?.price || '',
        url: lp.products?.url || '',
        image: lp.products?.primary_image_url || lp.products?.image_url,
        video_url: lp.products?.primary_video_url || undefined,
        thumbnail_url: lp.products?.primary_video_poster_url || lp.products?.primary_image_url || lp.products?.image_url || undefined,
        type: lp.products?.type ?? undefined,
        subtype: lp.products?.subtype ?? undefined,
      })),
  };
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

// ── Seen / unseen catalog ordering ─────────────────────────────
// Every consumer of a "feed of looks" (home grid, creator catalog,
// brand catalog) calls reorderBySeen() after fetching. The contract:
//   • Looks the shopper has NEVER seen come first, in their natural
//     feed order (preserves admin-curated rank).
//   • Looks the shopper HAS seen are appended after, shuffled, so the
//     re-visit doesn't feel like Groundhog Day.
//   • If the shopper has seen 100% of the catalog, the whole thing
//     reshuffles every time — pure rotation.
// "Seen" is derived from user_events impressions (target_type='look'),
// scoped to the signed-in user. Anonymous shoppers get the natural
// feed order untouched.

/** Pulls the set of look UUIDs the user has fired at least one
 *  impression event for. Capped at 50k events to stay responsive on
 *  heavy accounts; the LRU bias of `order desc` keeps the most
 *  recent / relevant impressions in the cap window. */
export async function fetchSeenLookIds(userId: string | null | undefined): Promise<Set<string>> {
  if (!supabase || !userId) return new Set();
  const { data } = await supabase
    .from('user_events')
    .select('target_uuid')
    .eq('user_id', userId)
    .eq('event_type', 'impression')
    .eq('target_type', 'look')
    .not('target_uuid', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50_000);
  return new Set((data || []).map(r => r.target_uuid as string).filter(Boolean));
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** Apply the unseen-first / shuffle-seen reorder rule described
 *  above. Pure function — does not mutate the input array. */
export function reorderBySeen(looks: Look[], seenLookIds: Set<string>): Look[] {
  if (!looks.length) return looks;
  const unseen: Look[] = [];
  const seen: Look[] = [];
  for (const l of looks) {
    const id = l.uuid;
    if (id && seenLookIds.has(id)) seen.push(l);
    else unseen.push(l);
  }
  // 100% seen → shuffle everything every visit.
  if (unseen.length === 0) {
    const all = [...looks];
    shuffleInPlace(all);
    return all;
  }
  // Some unseen → unseen in natural order, seen shuffled below.
  shuffleInPlace(seen);
  return [...unseen, ...seen];
}

// Admin surfaces (Content page, etc.) call this after a mutation so the next
// consumer fetch returns fresh data instead of a stale cached promise.
export function invalidateLooksCache() {
  looksPromise = null;
  creatorsPromise = null;
  suggestionsPromise = null;
  // Notify every subscribed surface that the cache is stale. Each
  // listener picks up the new value lazily on its next getLooks()
  // call — the broadcast just nudges them to re-fetch.
  for (const cb of looksChangeListeners) {
    try { cb(); } catch { /* listener threw — keep others alive */ }
  }
}

// Subscribers (ContinuousFeed, CreatorPage, anyone rendering the live
// catalog) register here. The change notification fires whenever the
// cache is invalidated, either from an in-tab admin mutation OR from
// the Supabase realtime channel below (cross-tab / cross-user
// propagation). Listeners typically respond by calling getLooks()
// again and setting state — no per-row diffing.
type LooksChangeListener = () => void;
const looksChangeListeners = new Set<LooksChangeListener>();
export function subscribeToLooksChange(cb: LooksChangeListener): () => void {
  looksChangeListeners.add(cb);
  return () => { looksChangeListeners.delete(cb); };
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

  // Realtime cross-tab / cross-user propagation. When an admin deletes
  // or unpublishes a look in /admin/data, this listener (subscribed in
  // every shopper's tab) drops the cached promise and notifies every
  // surface watching live look state — so the row vanishes from the
  // home feed without a refresh, the creator catalog updates live,
  // and so on. Same channel for INSERT (a freshly-published look pops
  // into the consumer feed in real time) and UPDATE (status flip from
  // 'live' to 'draft' via Unpublish disappears the row instantly).
  if (supabase) {
    supabase
      .channel('looks-live-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'looks' }, () => {
        invalidateLooksCache();
      })
      // looks_creative drives whether a look surfaces in
      // fetchLooksFromSupabase at all (the !inner join requires a
      // primary creative). Without listening to its INSERTs we'd miss
      // the moment a new published look becomes visible.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'looks_creative' }, () => {
        invalidateLooksCache();
      })
      .subscribe();
  }
}
