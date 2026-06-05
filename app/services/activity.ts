// Activity-screen data. Wraps two slices the /activity route renders:
//
//   1. Creator-side per-look performance — top N looks the signed-in
//      creator owns, with impression / click / clickout counts. Lives
//      next to getEngagementSummary() in services/creator-engagement
//      (lifetime totals) which the page also renders.
//
//   2. Shopper-self insights — counts the user's OWN clickouts and
//      groups them by product type / brand, so we can show "what you
//      click on most" and "your top brands". RLS policy
//      `user_events_owner_select` (WHERE auth.uid() = user_id) already
//      lets a signed-in user read their own events without a SECURITY
//      DEFINER RPC. We join to products client-side to surface name +
//      thumbnail.

import { supabase } from '~/utils/supabase';
import type { CommentTargetType } from '~/services/comments';
import { extractIdPrefix, extractLookId, nextHexPrefix } from '~/utils/slug';
import { looks as seedLooks } from '~/data/looks';

export interface ActivityLookStat {
  look_id: string;
  title: string | null;
  thumbnail_url: string | null;
  video_url: string | null;
  impressions: number;
  clicks: number;
  clickouts: number;
}

export interface ActivityTypeStat {
  type: string;
  count: number;
}

export interface ActivityBrandStat {
  brand: string;
  count: number;
  thumbnail_url: string | null;
}

export interface ActivityRecentEvent {
  id: string;
  event_type: 'impression' | 'click' | 'clickout';
  target_uuid: string | null;
  title: string | null;
  thumbnail_url: string | null;
  created_at: string;
}

// ── Creator-side ──────────────────────────────────────────────────────

/** Top looks by impressions for the signed-in creator. RLS
 *  `user_events_target_owner_select` allows the read.
 *  Aggregated client-side because the dataset is small (a creator with
 *  100 looks × 365 days of events is still a few thousand rows). */
export async function getMyTopLooks(limit = 10): Promise<ActivityLookStat[]> {
  if (!supabase) return [];
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return [];

  const { data, error } = await supabase
    .from('user_events')
    .select('event_type, target_uuid')
    .eq('target_type', 'look')
    .eq('target_owner_id', uid)
    .not('target_uuid', 'is', null)
    .limit(20000);
  if (error || !data) return [];

  // Group by look uuid.
  type Counts = { impressions: number; clicks: number; clickouts: number };
  const per = new Map<string, Counts>();
  for (const r of data as Array<{ event_type: string; target_uuid: string }>) {
    if (!r.target_uuid) continue;
    const cur = per.get(r.target_uuid) || { impressions: 0, clicks: 0, clickouts: 0 };
    if (r.event_type === 'impression') cur.impressions += 1;
    else if (r.event_type === 'click') cur.clicks += 1;
    else if (r.event_type === 'clickout') cur.clickouts += 1;
    per.set(r.target_uuid, cur);
  }

  // Rank candidates by impressions, then resolve to real look rows so we
  // can grab titles/media AND drop any look that isn't LIVE — archived or
  // deleted looks must not surface in the creator's Top Looks (they read
  // as blank-thumbnail ghost rows). Pull a wider candidate window than
  // `limit` so filtering out non-live looks still leaves enough to fill.
  const ranked = Array.from(per.entries())
    .sort((a, b) => b[1].impressions - a[1].impressions);
  const candidateIds = ranked.slice(0, Math.max(limit * 4, 40)).map(([id]) => id);
  if (candidateIds.length === 0) return [];

  // Titles + status come from `looks`; the poster + video live on
  // `looks_creative`. Prefer the primary creative + the mobile variant.
  const [{ data: looks }, { data: creatives }] = await Promise.all([
    supabase.from('looks').select('id, title, status').in('id', candidateIds),
    supabase.from('looks_creative')
      .select('look_id, is_primary, video_url, mobile_video_url, thumbnail_url')
      .in('look_id', candidateIds),
  ]);

  // Keep only looks that still exist AND are live.
  const titleById = new Map<string, string | null>();
  const liveIds = new Set<string>();
  for (const l of (looks as Array<{ id: string; title: string | null; status: string | null }> | null) || []) {
    if (l.status === 'live') { liveIds.add(l.id); titleById.set(l.id, l.title); }
  }

  // Final top N = the highest-impression candidates that are live.
  const topIds = candidateIds.filter(id => liveIds.has(id)).slice(0, limit);
  if (topIds.length === 0) return [];

  type Creative = { look_id: string; is_primary: boolean | null; video_url: string | null; mobile_video_url: string | null; thumbnail_url: string | null };
  const mediaById = new Map<string, { thumbnail_url: string | null; video_url: string | null }>();
  for (const c of (creatives as Creative[] | null) || []) {
    const existing = mediaById.get(c.look_id);
    // First creative wins, but a primary one always overrides.
    if (!existing || c.is_primary) {
      mediaById.set(c.look_id, {
        thumbnail_url: c.thumbnail_url,
        video_url: c.mobile_video_url || c.video_url,
      });
    }
  }

  return topIds.map(id => {
    const c = per.get(id) || { impressions: 0, clicks: 0, clickouts: 0 };
    const media = mediaById.get(id);
    return {
      look_id: id,
      title: titleById.get(id) ?? null,
      thumbnail_url: media?.thumbnail_url ?? null,
      video_url: media?.video_url ?? null,
      ...c,
    };
  });
}

// ── Shopper-side ──────────────────────────────────────────────────────

/** Reads the user's OWN clickouts (event_type='clickout', user_id=me)
 *  with the joined product type + brand, then counts by type/brand.
 *  Returns { topTypes, topBrands, totalClickouts }. Resolves to empty
 *  state when the user has no clickouts yet. */
export async function getMyShopperSelf(opts: { typeLimit?: number; brandLimit?: number } = {}): Promise<{
  topTypes: ActivityTypeStat[];
  topBrands: ActivityBrandStat[];
  totalClickouts: number;
}> {
  const typeLimit = opts.typeLimit ?? 6;
  const brandLimit = opts.brandLimit ?? 6;
  if (!supabase) return { topTypes: [], topBrands: [], totalClickouts: 0 };
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return { topTypes: [], topBrands: [], totalClickouts: 0 };

  // Pull the user's product clickouts. Two passes: first the raw event
  // (RLS limits to own rows via user_events_owner_select), then resolve
  // the product metadata in one IN(...) lookup.
  const { data: events, error } = await supabase
    .from('user_events')
    .select('target_uuid, created_at')
    .eq('user_id', uid)
    .eq('event_type', 'clickout')
    .eq('target_type', 'product')
    .not('target_uuid', 'is', null)
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error || !events || events.length === 0) {
    return { topTypes: [], topBrands: [], totalClickouts: 0 };
  }

  const productIds = Array.from(new Set(
    (events as Array<{ target_uuid: string }>).map(e => e.target_uuid).filter(Boolean),
  ));
  const { data: products } = await supabase
    .from('products')
    .select('id, type, brand, primary_image_url, image_url')
    .in('id', productIds);

  type ProductMeta = { type: string | null; brand: string | null; primary_image_url: string | null; image_url: string | null };
  const meta = new Map<string, ProductMeta>();
  for (const p of (products as Array<{ id: string } & ProductMeta> | null) || []) {
    meta.set(p.id, { type: p.type, brand: p.brand, primary_image_url: p.primary_image_url, image_url: p.image_url });
  }

  const byType = new Map<string, number>();
  const byBrand = new Map<string, { count: number; thumb: string | null }>();
  for (const e of events as Array<{ target_uuid: string }>) {
    const m = meta.get(e.target_uuid);
    if (!m) continue;
    if (m.type) byType.set(m.type, (byType.get(m.type) || 0) + 1);
    if (m.brand) {
      const cur = byBrand.get(m.brand) || { count: 0, thumb: null };
      cur.count += 1;
      if (!cur.thumb) cur.thumb = m.primary_image_url || m.image_url;
      byBrand.set(m.brand, cur);
    }
  }

  const topTypes = Array.from(byType.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, typeLimit)
    .map(([type, count]) => ({ type, count }));

  const topBrands = Array.from(byBrand.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, brandLimit)
    .map(([brand, { count, thumb }]) => ({ brand, count, thumbnail_url: thumb }));

  return { topTypes, topBrands, totalClickouts: events.length };
}

// ── Recent activity ───────────────────────────────────────────────────

/** A small chronological stream of the most recent events targeting the
 *  signed-in creator. Used for the realtime ticker at the top of the
 *  /activity page. RLS: target_owner_id = uid. */
export async function getMyRecentEvents(limit = 12): Promise<ActivityRecentEvent[]> {
  if (!supabase) return [];
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return [];

  const { data, error } = await supabase
    .from('user_events')
    .select('id, event_type, target_uuid, target_type, created_at')
    .eq('target_owner_id', uid)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];

  type Row = { id: string; event_type: string; target_uuid: string | null; target_type: string; created_at: string };
  const rows = data as Row[];
  const lookIds = Array.from(new Set(rows.filter(r => r.target_type === 'look' && r.target_uuid).map(r => r.target_uuid!)));
  const titleById = new Map<string, { title: string | null; thumbnail_url: string | null }>();
  if (lookIds.length > 0) {
    const { data: looks } = await supabase
      .from('looks')
      .select('id, title, thumbnail_url')
      .in('id', lookIds);
    for (const l of (looks as Array<{ id: string; title: string | null; thumbnail_url: string | null }> | null) || []) {
      titleById.set(l.id, { title: l.title, thumbnail_url: l.thumbnail_url });
    }
  }

  return rows.map(r => {
    const m = r.target_uuid ? titleById.get(r.target_uuid) : null;
    const et = r.event_type as ActivityRecentEvent['event_type'];
    return {
      id: r.id,
      event_type: et === 'impression' || et === 'click' || et === 'clickout' ? et : 'impression',
      target_uuid: r.target_uuid,
      title: m?.title ?? null,
      thumbnail_url: m?.thumbnail_url ?? null,
      created_at: r.created_at,
    };
  });
}

// ── Comments & 🔥 activity ─────────────────────────────────────────────
//
// Surfaces the conversational side of the signed-in user's activity:
//   • mine  — comments you posted
//   • reply — someone else commented on a thread you're in
//   • fire  — someone fired one of your comments (with running total +
//             a milestone flag at five fires)
// All keyed/linked back to the product or look the thread is about so a
// tap deep-links into /comments/<type>/<slug>.

export interface CommentActivityItem {
  id: string;
  kind: 'mine' | 'reply' | 'fire';
  body: string;
  target_type: CommentTargetType;
  target_id: string;
  target_label: string | null;
  created_at: string;
  actor_name?: string | null;
  actor_avatar?: string | null;
  fire_count?: number;
  milestone?: boolean;
}

export interface CommentMedia {
  image: string | null;
  video: string | null;
}

// UUID range bounds for an 8-char prefix lookup (same trick the overlay
// router + CommentsPage use to turn a slug suffix into a row).
const UUID_RANGE_TAIL = '-0000-0000-0000-000000000000';

/**
 * Resolve a comment's target (product/look slug) to a poster image +
 * primary video, so the Activity "Conversations" cards can paint a still
 * and then autoplay the clip. Returns nulls when nothing matches so the
 * caller can fall back to a placeholder.
 */
export async function resolveCommentMedia(
  targetType: CommentTargetType,
  targetId: string,
): Promise<CommentMedia> {
  if (!supabase) return { image: null, video: null };

  if (targetType === 'product') {
    const prefix = extractIdPrefix(targetId);
    if (!prefix) return { image: null, video: null };
    const next = nextHexPrefix(prefix);
    let q = supabase
      .from('products')
      .select('primary_image_url, image_url, primary_video_url, primary_video_poster_url')
      .gte('id', `${prefix}${UUID_RANGE_TAIL}`);
    if (next) q = q.lt('id', `${next}${UUID_RANGE_TAIL}`);
    const { data } = await q.limit(1);
    const row = data?.[0] as {
      primary_image_url: string | null; image_url: string | null;
      primary_video_url: string | null; primary_video_poster_url: string | null;
    } | undefined;
    if (!row) return { image: null, video: null };
    return {
      image: row.primary_video_poster_url || row.primary_image_url || row.image_url || null,
      video: row.primary_video_url || null,
    };
  }

  // Look — numeric seed ids resolve to the bundled catalog; DB looks use
  // the looks_creative uuid-prefix range.
  const numericId = extractLookId(targetId);
  if (numericId != null) {
    const seed = seedLooks.find(l => l.id === numericId);
    if (seed) return { image: seed.creatorAvatar || null, video: null };
  }
  const prefix = extractIdPrefix(targetId);
  if (!prefix) return { image: null, video: null };
  const next = nextHexPrefix(prefix);
  let q = supabase
    .from('looks_creative')
    .select('thumbnail_url, video_url, mobile_video_url')
    .gte('uuid', `${prefix}${UUID_RANGE_TAIL}`);
  if (next) q = q.lt('uuid', `${next}${UUID_RANGE_TAIL}`);
  const { data } = await q.limit(1);
  const row = data?.[0] as {
    thumbnail_url: string | null; video_url: string | null; mobile_video_url: string | null;
  } | undefined;
  if (!row) return { image: null, video: null };
  return {
    image: row.thumbnail_url || null,
    video: row.mobile_video_url || row.video_url || null,
  };
}

export async function getMyCommentActivity(limit = 30): Promise<CommentActivityItem[]> {
  if (!supabase) return [];
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return [];

  // 1) My own comments.
  const { data: mineRows } = await supabase
    .from('comments')
    .select('id, target_type, target_id, target_label, body, created_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(80);
  type Mine = { id: string; target_type: CommentTargetType; target_id: string; target_label: string | null; body: string; created_at: string };
  const mine = (mineRows as Mine[] | null) || [];
  const myCommentIds = mine.map(m => m.id);
  const myThreadIds = Array.from(new Set(mine.map(m => m.target_id)));
  const labelByThread = new Map<string, string | null>();
  for (const m of mine) if (!labelByThread.has(m.target_id)) labelByThread.set(m.target_id, m.target_label);

  const items: CommentActivityItem[] = mine.map(m => ({
    id: `mine:${m.id}`,
    kind: 'mine' as const,
    body: m.body,
    target_type: m.target_type,
    target_id: m.target_id,
    target_label: m.target_label,
    created_at: m.created_at,
  }));

  // 2) Replies — others' comments on threads I'm in, after my first
  //    comment there (so we don't surface pre-existing comments).
  const earliestMineByThread = new Map<string, string>();
  for (const m of [...mine].reverse()) {
    if (!earliestMineByThread.has(m.target_id)) earliestMineByThread.set(m.target_id, m.created_at);
  }
  if (myThreadIds.length > 0) {
    const { data: replyRows } = await supabase
      .from('comments')
      .select('id, target_type, target_id, target_label, body, created_at, user_id, author:profiles!comments_user_id_fkey ( full_name, avatar_url )')
      .in('target_id', myThreadIds)
      .neq('user_id', uid)
      .eq('hidden', false)
      .order('created_at', { ascending: false })
      .limit(60);
    type Reply = { id: string; target_type: CommentTargetType; target_id: string; target_label: string | null; body: string; created_at: string; author: { full_name: string | null; avatar_url: string | null } | null };
    for (const r of (replyRows as unknown as Reply[] | null) || []) {
      const mineAt = earliestMineByThread.get(r.target_id);
      if (mineAt && Date.parse(r.created_at) <= Date.parse(mineAt)) continue;
      items.push({
        id: `reply:${r.id}`,
        kind: 'reply',
        body: r.body,
        target_type: r.target_type,
        target_id: r.target_id,
        target_label: r.target_label ?? labelByThread.get(r.target_id) ?? null,
        created_at: r.created_at,
        actor_name: r.author?.full_name ?? null,
        actor_avatar: r.author?.avatar_url ?? null,
      });
    }
  }

  // 3) Fires received on my comments (others only). Grouped to a count +
  //    milestone flag; dated by the most recent fire.
  if (myCommentIds.length > 0) {
    const { data: fireRows } = await supabase
      .from('comment_reactions')
      .select('comment_id, user_id, created_at')
      .eq('kind', 'fire')
      .in('comment_id', myCommentIds)
      .neq('user_id', uid);
    type Fire = { comment_id: string; user_id: string; created_at: string };
    const byComment = new Map<string, { count: number; latest: string }>();
    for (const f of (fireRows as Fire[] | null) || []) {
      const cur = byComment.get(f.comment_id) || { count: 0, latest: f.created_at };
      cur.count += 1;
      if (Date.parse(f.created_at) > Date.parse(cur.latest)) cur.latest = f.created_at;
      byComment.set(f.comment_id, cur);
    }
    const mineById = new Map(mine.map(m => [m.id, m]));
    for (const [cid, { count, latest }] of byComment) {
      const m = mineById.get(cid);
      if (!m) continue;
      items.push({
        id: `fire:${cid}`,
        kind: 'fire',
        body: m.body,
        target_type: m.target_type,
        target_id: m.target_id,
        target_label: m.target_label,
        created_at: latest,
        fire_count: count,
        milestone: count >= 5,
      });
    }
  }

  items.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return items.slice(0, limit);
}
