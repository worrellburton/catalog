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

  // Resolve the top N (by impressions) to actual look rows for titles
  // + thumbnails. One round trip in the IN(...) clause.
  const topIds = Array.from(per.entries())
    .sort((a, b) => b[1].impressions - a[1].impressions)
    .slice(0, limit)
    .map(([id]) => id);
  if (topIds.length === 0) return [];

  // Titles come from `looks`; the poster + video live on `looks_creative`
  // (the `looks` table carries no media columns). Prefer the primary
  // creative, and the mobile video variant when present (smaller payload).
  const [{ data: looks }, { data: creatives }] = await Promise.all([
    supabase.from('looks').select('id, title').in('id', topIds),
    supabase.from('looks_creative')
      .select('look_id, is_primary, video_url, mobile_video_url, thumbnail_url')
      .in('look_id', topIds),
  ]);

  const titleById = new Map<string, string | null>();
  for (const l of (looks as Array<{ id: string; title: string | null }> | null) || []) {
    titleById.set(l.id, l.title);
  }

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
