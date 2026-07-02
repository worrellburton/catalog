// Style Up — data layer for the AI-stylist chat (admin-gated v1).
//
// Tables (migration 20260626000000): style_up_stylists (the roster),
// style_up_threads (one ongoing convo per shopper↔stylist), style_up_messages
// (the chat log — text / product card / on-you render). RLS scopes threads +
// messages to the signed-in shopper (admins see all); the roster is world-read.

import { supabase } from '~/utils/supabase';
import { getUserHeightAge, getUserCustomStyle } from '~/services/profiles';
import { getUserGender } from '~/services/genders';
import { getUserSlots, createGeneration, buildGenerationPrompt } from '~/services/user-generations';
import { roleForProduct } from '~/services/product-roles';
import { getLookVideoQuality, getLookVideoDuration } from '~/services/dials';
import type { StylistEngineMethod } from '~/services/dials';

export interface StyleUpStylist {
  id: string;
  name: string;
  avatarUrl: string | null;
  specialty: string | null;
  bio: string | null;
  /** Where the stylist is based + how old they are (shown on the picker). */
  city: string | null;
  age: number | null;
  accentColor: string | null;
  /** Where this stylist's picks come from: 'catalog' = our own products,
   *  'web' = the open web (searched + auto-imported on the fly). */
  sourceMode: 'catalog' | 'web';
  /** Marks the two stylists featured on the /style landing page (else null). */
  landingSlot: string | null;
}

/** A product attached to a chat message (the stylist's pick). Loose by design
 *  so a catalog row, a scraped URL, or an uploaded image all fit. */
export interface StyleUpProductRef {
  id?: string;
  name?: string;
  brand?: string;
  image?: string;
  price?: string;
  url?: string;
  /** When present, this `product` message is actually a swap picker — a set of
   *  alternatives for one slot the shopper can choose from (e.g. 3 pants). */
  swap?: { role: string; label: string; options: StyleUpProductRef[] };
  /** A generic tap-chooser — "which shoes?", "what do you want in the outfit?".
   *  `kind` routes the selection; `multi` allows picking several. Options can
   *  carry a product ref (shoe pick) or just a value/label (slot pick). */
  choose?: {
    kind: string;
    prompt: string;
    multi?: boolean;
    options: Array<{ value: string; label: string; image?: string; ref?: StyleUpProductRef }>;
  };
  /** On a `render` caption: the pieces composited into the look, so the chat
   *  can show them while it cooks and when it's done. */
  pieces?: StyleUpProductRef[];
}

export type StyleUpSender = 'shopper' | 'stylist';
export type StyleUpKind = 'text' | 'product' | 'render';

export interface StyleUpMessage {
  id: string;
  threadId: string;
  sender: StyleUpSender;
  kind: StyleUpKind;
  body: string | null;
  productRef: StyleUpProductRef | null;
  renderGenerationId: string | null;
  createdAt: string;
}

function mapStylist(r: Record<string, unknown>): StyleUpStylist {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    avatarUrl: (r.avatar_url as string | null) ?? null,
    specialty: (r.specialty as string | null) ?? null,
    bio: (r.bio as string | null) ?? null,
    city: (r.city as string | null) ?? null,
    age: typeof r.age === 'number' ? r.age : (r.age != null ? Number(r.age) : null),
    accentColor: (r.accent_color as string | null) ?? null,
    sourceMode: (r.source_mode as 'catalog' | 'web') === 'web' ? 'web' : 'catalog',
    landingSlot: (r.landing_slot as string | null) ?? null,
  };
}

// Every stylist column the client maps. Centralized so every select stays in
// sync with mapStylist (source_mode / landing_slot were easy to forget).
const STYLIST_COLS = 'id, name, avatar_url, specialty, bio, city, age, accent_color, source_mode, landing_slot';
const STYLIST_JOIN = `stylist:style_up_stylists(${STYLIST_COLS})`;

function mapMessage(r: Record<string, unknown>): StyleUpMessage {
  return {
    id: String(r.id),
    threadId: String(r.thread_id),
    sender: (r.sender as StyleUpSender) ?? 'stylist',
    kind: (r.kind as StyleUpKind) ?? 'text',
    body: (r.body as string | null) ?? null,
    productRef: (r.product_ref as StyleUpProductRef | null) ?? null,
    renderGenerationId: (r.render_generation_id as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

/** The active stylist roster, in display order. Pass `landingOnly` to get just
 *  the two stylists featured on the /style landing page (landing_slot set). */
export async function fetchStylists(opts: { landingOnly?: boolean } = {}): Promise<StyleUpStylist[]> {
  if (!supabase) return [];
  let q = supabase
    .from('style_up_stylists')
    .select(STYLIST_COLS)
    .eq('is_active', true);
  if (opts.landingOnly) q = q.not('landing_slot', 'is', null);
  const { data, error } = await q.order('sort', { ascending: true });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapStylist);
}

/** Find (or open) the shopper's ongoing thread with a stylist. One thread per
 *  pairing (DB unique constraint), so requesting the same stylist resumes the
 *  existing conversation. Returns the thread id, or null on failure. */
export async function getOrCreateThread(
  stylistId: string,
  shopperUserId: string,
): Promise<string | null> {
  if (!supabase) return null;
  const { data: existing } = await supabase
    .from('style_up_threads')
    .select('id')
    .eq('shopper_user_id', shopperUserId)
    .eq('stylist_id', stylistId)
    .maybeSingle();
  if (existing?.id) return String(existing.id);

  const { data, error } = await supabase
    .from('style_up_threads')
    .insert({ shopper_user_id: shopperUserId, stylist_id: stylistId })
    .select('id')
    .single();
  if (error || !data) return null;
  return String(data.id);
}

/** Delete a conversation (and its messages, via ON DELETE CASCADE). RLS scopes
 *  this to the owning shopper. Returns true on success. */
export async function deleteThread(threadId: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('style_up_threads').delete().eq('id', threadId);
  return !error;
}

/** The thread's server-side "web hunt in progress" marker (a future timestamp
 *  while the edge function is still pulling pieces, else null/past). Drives the
 *  working indicator so it survives refresh/navigation. */
export async function getThreadHunting(threadId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('style_up_threads')
    .select('hunting_until')
    .eq('id', threadId)
    .maybeSingle();
  return (data?.hunting_until as string | null) ?? null;
}

export interface StyleUpThreadSummary {
  threadId: string;
  stylist: StyleUpStylist;
  lastMessage: string | null;
  lastMessageAt: string | null;
}

/** All of the shopper's conversations that have at least one message, newest
 *  first, each with a short preview of the last message — so the roster can
 *  surface ongoing chats to resume. */
export async function fetchMyThreads(shopperUserId: string): Promise<StyleUpThreadSummary[]> {
  if (!supabase) return [];
  const { data: threads } = await supabase
    .from('style_up_threads')
    .select(`id, last_message_at, ${STYLIST_JOIN}`)
    .eq('shopper_user_id', shopperUserId)
    .order('last_message_at', { ascending: false });
  if (!threads || threads.length === 0) return [];

  const ids = threads.map(t => String(t.id));
  const { data: msgs } = await supabase
    .from('style_up_messages')
    .select('thread_id, sender, kind, body, created_at')
    .in('thread_id', ids)
    .order('created_at', { ascending: false });

  const preview = new Map<string, string>();
  for (const m of (msgs ?? []) as Array<{ thread_id: string; sender: string; kind: string; body: string | null }>) {
    const tid = String(m.thread_id);
    if (preview.has(tid)) continue;
    let text = m.kind === 'product' ? 'Sent a product pick'
      : m.kind === 'render' ? 'Sent a look'
      : (m.body ?? '');
    if (m.sender === 'shopper') text = `You: ${text}`;
    preview.set(tid, text);
  }

  return threads
    .map(t => {
      const raw = Array.isArray(t.stylist) ? t.stylist[0] : t.stylist;
      if (!raw) return null;
      const tid = String(t.id);
      // Only surface threads that actually have a message.
      if (!preview.has(tid)) return null;
      return {
        threadId: tid,
        stylist: mapStylist(raw as Record<string, unknown>),
        lastMessage: preview.get(tid) ?? null,
        lastMessageAt: (t.last_message_at as string | null) ?? null,
      };
    })
    .filter((x): x is StyleUpThreadSummary => !!x);
}

// ── Admin monitoring (admin StyleUp dashboard) ──────────────────────────────
// Admins have full RLS access to threads / messages / generations, so these
// run client-side from the admin page (which is already admin-gated).

export interface AdminShopper { id: string; name: string; avatarUrl: string | null; }

export interface AdminThread {
  threadId: string;
  shopper: AdminShopper;
  stylist: StyleUpStylist;
  lastMessage: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  awaitingStylist: boolean; // latest message is from the shopper
}

export interface AdminLook {
  messageId: string;
  threadId: string;
  generationId: string | null;
  status: string;
  videoUrl: string | null;
  createdAt: string;
  shopper: AdminShopper;
  stylist: StyleUpStylist | null;
  products: StyleUpProductRef[];
}

// ── Research traces (admin "view research" node diagram) ────────────────────
export interface StyleUpTraceSearch {
  query: string;
  ok: boolean;
  error: string | null;
  rawCount: number;
  withUrl: number;
  matched: number;
  importedId?: string | null;
  importedName?: string | null;
}
export interface StyleUpTrace {
  id: string;
  threadId: string;
  sourceMode: string | null;
  createdAt: string;
  payload: Record<string, unknown>;     // edge-written turn record
  searches: StyleUpTraceSearch[] | null; // client-enriched per-query results
}

/** Enrich a turn's trace with the per-query web search results (client side). */
export async function appendTraceSearches(traceId: string, searches: StyleUpTraceSearch[]): Promise<void> {
  if (!supabase || !traceId) return;
  await supabase.from('style_up_traces').update({ searches }).eq('id', traceId);
}

/** Admin: the research traces for a thread, newest first. */
export async function adminListTraces(threadId: string, limit = 20): Promise<StyleUpTrace[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from('style_up_traces')
    .select('id, thread_id, source_mode, payload, searches, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({
    id: String(r.id),
    threadId: String(r.thread_id),
    sourceMode: (r.source_mode as string | null) ?? null,
    createdAt: String(r.created_at),
    payload: (r.payload as Record<string, unknown>) ?? {},
    searches: (r.searches as StyleUpTraceSearch[] | null) ?? null,
  }));
}

function previewOf(kind: string, body: string | null): string {
  if (kind === 'product') return 'Product pick';
  if (kind === 'render') return 'On-you look';
  return body ?? '';
}

async function shopperMap(ids: string[]): Promise<Map<string, AdminShopper>> {
  const out = new Map<string, AdminShopper>();
  if (!supabase || ids.length === 0) return out;
  const { data } = await supabase
    .from('profiles').select('id, full_name, avatar_url').in('id', ids);
  for (const r of (data ?? []) as Array<{ id: string; full_name: string | null; avatar_url: string | null }>) {
    out.set(r.id, { id: r.id, name: r.full_name || 'Shopper', avatarUrl: r.avatar_url ?? null });
  }
  return out;
}

/** Every conversation with at least one message — newest activity first — with
 *  the shopper, stylist, last-message preview, count, and whether it's waiting
 *  on the stylist. */
export async function adminListThreads(): Promise<AdminThread[]> {
  if (!supabase) return [];
  const { data: threads } = await supabase
    .from('style_up_threads')
    .select(`id, shopper_user_id, last_message_at, ${STYLIST_JOIN}`)
    .order('last_message_at', { ascending: false });
  if (!threads || threads.length === 0) return [];

  const ids = threads.map(t => String(t.id));
  const { data: msgs } = await supabase
    .from('style_up_messages')
    .select('thread_id, sender, kind, body, created_at')
    .in('thread_id', ids)
    .order('created_at', { ascending: false });

  const count = new Map<string, number>();
  const last = new Map<string, { sender: string; kind: string; body: string | null }>();
  for (const m of (msgs ?? []) as Array<{ thread_id: string; sender: string; kind: string; body: string | null }>) {
    const tid = String(m.thread_id);
    count.set(tid, (count.get(tid) ?? 0) + 1);
    if (!last.has(tid)) last.set(tid, m);
  }

  const shoppers = await shopperMap([...new Set(threads.map(t => String(t.shopper_user_id)))]);

  return threads
    .map((t): AdminThread | null => {
      const tid = String(t.id);
      if (!last.has(tid)) return null; // ≥1 message only
      const raw = Array.isArray(t.stylist) ? t.stylist[0] : t.stylist;
      const lm = last.get(tid)!;
      return {
        threadId: tid,
        shopper: shoppers.get(String(t.shopper_user_id)) ?? { id: String(t.shopper_user_id), name: 'Shopper', avatarUrl: null },
        stylist: mapStylist((raw ?? {}) as Record<string, unknown>),
        lastMessage: previewOf(lm.kind, lm.body),
        lastMessageAt: (t.last_message_at as string | null) ?? null,
        messageCount: count.get(tid) ?? 0,
        awaitingStylist: lm.sender === 'shopper',
      };
    })
    .filter((x): x is AdminThread => !!x);
}

/** All StyleUp-generated looks (render messages) with their generation status,
 *  video, the shopper, stylist, and the pieces in the look. */
export async function adminListLooks(limit = 120): Promise<AdminLook[]> {
  if (!supabase) return [];
  const { data: renders } = await supabase
    .from('style_up_messages')
    .select('id, thread_id, render_generation_id, product_ref, created_at')
    .eq('kind', 'render')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (!renders || renders.length === 0) return [];

  const genIds = renders.map(r => r.render_generation_id).filter((x): x is string => !!x);
  const threadIds = [...new Set(renders.map(r => String(r.thread_id)))];

  const [{ data: gens }, { data: gprods }, { data: threads }] = await Promise.all([
    supabase.from('user_generations').select('id, status, video_url, created_at').in('id', genIds.length ? genIds : ['00000000-0000-0000-0000-000000000000']),
    supabase.from('user_generation_products').select('generation_id, sort_order, products(name, brand, image_url, primary_image_url, url)').in('generation_id', genIds.length ? genIds : ['00000000-0000-0000-0000-000000000000']),
    supabase.from('style_up_threads').select(`id, shopper_user_id, ${STYLIST_JOIN}`).in('id', threadIds.length ? threadIds : ['00000000-0000-0000-0000-000000000000']),
  ]);

  const genById = new Map(((gens ?? []) as Array<{ id: string; status: string; video_url: string | null; created_at: string }>).map(g => [g.id, g]));
  const prodsByGen = new Map<string, StyleUpProductRef[]>();
  for (const r of (gprods ?? []) as Array<{ generation_id: string; products: { name: string | null; brand: string | null; image_url: string | null; primary_image_url: string | null; url: string | null } | { name: string | null; brand: string | null; image_url: string | null; primary_image_url: string | null; url: string | null }[] | null }>) {
    const p = Array.isArray(r.products) ? r.products[0] : r.products;
    if (!p) continue;
    const list = prodsByGen.get(r.generation_id) ?? [];
    list.push({ name: p.name ?? undefined, brand: p.brand ?? undefined, image: p.primary_image_url || p.image_url || undefined, url: p.url ?? undefined });
    prodsByGen.set(r.generation_id, list);
  }
  const threadById = new Map(((threads ?? []) as Array<Record<string, unknown>>).map(t => [String(t.id), t]));
  const shoppers = await shopperMap([...new Set(((threads ?? []) as Array<{ shopper_user_id: string }>).map(t => String(t.shopper_user_id)))]);

  return renders.map(r => {
    const t = threadById.get(String(r.thread_id));
    const rawStylist = t ? (Array.isArray(t.stylist) ? (t.stylist as unknown[])[0] : t.stylist) : null;
    const gid = r.render_generation_id as string | null;
    const gen = gid ? genById.get(gid) : null;
    const fallback = (r.product_ref as StyleUpProductRef | null);
    const products = (gid && prodsByGen.get(gid)) || (fallback ? [fallback] : []);
    return {
      messageId: String(r.id),
      threadId: String(r.thread_id),
      generationId: gid,
      status: gen?.status ?? 'pending',
      videoUrl: gen?.video_url ?? null,
      createdAt: String(r.created_at),
      shopper: t ? (shoppers.get(String((t as { shopper_user_id: string }).shopper_user_id)) ?? { id: '', name: 'Shopper', avatarUrl: null }) : { id: '', name: 'Shopper', avatarUrl: null },
      stylist: rawStylist ? mapStylist(rawStylist as Record<string, unknown>) : null,
      products,
    };
  });
}

/** Admin: post a stylist message into any thread (reply on behalf of stylist). */
export async function adminSendStylistMessage(threadId: string, text: string): Promise<boolean> {
  return !!(await sendStylistText(threadId, text));
}

/** Admin: delete a conversation (cascades to its messages). */
export async function adminDeleteThread(threadId: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'No database connection' };
  const { error } = await supabase.from('style_up_threads').delete().eq('id', threadId);
  return { error: error?.message ?? null };
}

/** Admin: remove a generated look from its thread (deletes the render message). */
export async function adminDeleteLook(messageId: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'No database connection' };
  const { error } = await supabase.from('style_up_messages').delete().eq('id', messageId);
  return { error: error?.message ?? null };
}

/** The shopper's most-recently-active thread (+ its stylist), or null. Used to
 *  resume the ongoing conversation on open so the chat history keeps going. */
export async function getLatestThread(
  shopperUserId: string,
): Promise<{ threadId: string; stylist: StyleUpStylist } | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('style_up_threads')
    .select(`id, ${STYLIST_JOIN}`)
    .eq('shopper_user_id', shopperUserId)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data || !data.stylist) return null;
  const raw = Array.isArray(data.stylist) ? data.stylist[0] : data.stylist;
  if (!raw) return null;
  return { threadId: String(data.id), stylist: mapStylist(raw as Record<string, unknown>) };
}

/** Every message in a thread, oldest first. */
export async function fetchMessages(threadId: string): Promise<StyleUpMessage[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('style_up_messages')
    .select('id, thread_id, sender, kind, body, product_ref, render_generation_id, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapMessage);
}

/** Post a shopper text message and bump the thread's last_message_at. */
export async function sendShopperMessage(
  threadId: string,
  text: string,
): Promise<StyleUpMessage | null> {
  if (!supabase || !text.trim()) return null;
  const { data, error } = await supabase
    .from('style_up_messages')
    .insert({ thread_id: threadId, sender: 'shopper', kind: 'text', body: text.trim() })
    .select('id, thread_id, sender, kind, body, product_ref, render_generation_id, created_at')
    .single();
  if (error || !data) return null;
  await supabase
    .from('style_up_threads')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', threadId);
  return mapMessage(data as Record<string, unknown>);
}

/** Post a stylist text message (client-side, owner-scoped). Used for the
 *  conversational "Generating a look now…" beat before a full-look render kicks
 *  off — the same owner-insert path the render/product messages already use. */
export async function sendStylistText(
  threadId: string,
  text: string,
): Promise<StyleUpMessage | null> {
  if (!supabase || !text.trim()) return null;
  const { data, error } = await supabase
    .from('style_up_messages')
    .insert({ thread_id: threadId, sender: 'stylist', kind: 'text', body: text.trim() })
    .select('id, thread_id, sender, kind, body, product_ref, render_generation_id, created_at')
    .single();
  if (error || !data) return null;
  await supabase
    .from('style_up_threads')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', threadId);
  return mapMessage(data as Record<string, unknown>);
}

// Render the shopper wearing one or more stylist picks, reusing the exact
// generate-look (Seedance) pipeline the AI-look flow uses. Pulls the shopper's
// reference photos + context, maps each pick's type → role tag (head-to-toe
// placement), kicks ONE generation for the whole set, and drops a `render`
// message the chat polls to completion.
const MAX_REF_PHOTOS = 3;
const MAX_LOOK_PIECES = 6;

async function renderLook(
  threadId: string,
  shopperUserId: string,
  picks: StyleUpProductRef[],
  caption: StyleUpProductRef,
  replace?: { role: string; product: StyleUpProductRef } | null,
  scene?: string | null,
): Promise<{ generationId: string | null; error: string | null }> {
  if (!supabase) return { generationId: null, error: 'No database connection' };

  const withId = picks.filter(p => !!p.id).slice(0, MAX_LOOK_PIECES);
  // The replacement piece must be renderable even if the base set was empty.
  if (withId.length === 0 && !replace?.product.id) {
    return { generationId: null, error: "These picks can't be rendered yet." };
  }

  const [ha, gender, customStyle, slots, quality, duration] = await Promise.all([
    getUserHeightAge(shopperUserId),
    getUserGender(shopperUserId),
    getUserCustomStyle(shopperUserId),
    getUserSlots(shopperUserId, MAX_REF_PHOTOS),
    getLookVideoQuality(),   // admin dial: 'fast' | 'pro' Seedance tier
    getLookVideoDuration(),  // admin dial: clip length in seconds
  ]);
  const uploadIds = slots.filter((x): x is string => !!x);
  if (uploadIds.length === 0) {
    return { generationId: null, error: 'Add a photo of yourself in the AI studio first, then try again.' };
  }

  // Resolve product type/name/brand from the catalog so role tags + the prompt
  // stay accurate even when a chat ref only carried a name.
  const ids = [...withId.map(p => p.id as string), ...(replace?.product.id ? [replace.product.id] : [])];
  const { data: rows } = await supabase
    .from('products').select('id, type, name, brand').in('id', ids);
  const byId = new Map(((rows ?? []) as Array<{ id: string; type: string | null; name: string | null; brand: string | null }>).map(r => [r.id, r]));

  let lines = withId.map(p => {
    const row = byId.get(p.id as string);
    const name = row?.name ?? p.name ?? null;
    const brand = row?.brand ?? p.brand ?? null;
    const roleTag = roleForProduct(row?.type ?? null, name);
    return { product_id: p.id as string, roleTag, name, brand };
  });

  // Slot swap: drop whatever currently fills the target role and add the pick.
  if (replace?.product.id) {
    lines = lines.filter(l => l.roleTag !== replace.role);
    const row = byId.get(replace.product.id);
    const name = row?.name ?? replace.product.name ?? null;
    const brand = row?.brand ?? replace.product.brand ?? null;
    lines.push({ product_id: replace.product.id, roleTag: roleForProduct(row?.type ?? null, name), name, brand });
  }

  // De-dupe by product_id — user_generation_products has a unique (generation,
  // product) key, so a repeated pick (or a swap that collides) would otherwise
  // throw "duplicate key … user_generation_products_pkey".
  {
    const seen = new Set<string>();
    lines = lines.filter(l => (seen.has(l.product_id) ? false : (seen.add(l.product_id), true)));
  }

  let prompt = buildGenerationPrompt({
    heightLabel: ha.heightLabel ?? '',
    weightLabel: ha.weightLabel,
    ageLabel: ha.ageLabel ?? undefined,
    style: 'editorial',
    customStyle,
    gender,
    productLines: lines.map(l => ({ role_tag: l.roleTag, brand: l.brand, name: l.name })),
    durationSeconds: duration,
  });
  // Scene/setting the shopper chose ("clean studio", "rooftop at golden hour"…).
  if (scene && scene.trim()) prompt += `\n\nSetting: ${scene.trim()}. Place the subject naturally in this environment.`;

  const { data: gen, error } = await createGeneration({
    userId: shopperUserId,
    uploadIds,
    products: lines.map((l, i) => ({ product_id: l.product_id, role_tag: l.roleTag, sort_order: i })),
    heightCm: ha.heightCm ?? 178,
    heightLabel: ha.heightLabel ?? '5\'10"',
    ageLabel: ha.ageLabel ?? 'mid 20s',
    weightLabel: ha.weightLabel,
    style: 'editorial',
    prompt,
    durationSeconds: duration,
    model: quality,
  });
  if (error || !gen) return { generationId: null, error: error ?? 'Render failed to start' };

  // Carry the pieces (with images) on the render caption so the chat can show
  // what went into the look while it cooks and once it's done.
  const imageById = new Map<string, string | undefined>();
  for (const p of [...picks, ...(replace?.product ? [replace.product] : [])]) {
    if (p.id) imageById.set(p.id, p.image);
  }
  const pieces: StyleUpProductRef[] = lines.map(l => ({
    id: l.product_id, name: l.name ?? undefined, brand: l.brand ?? undefined, image: imageById.get(l.product_id),
  }));

  await supabase.from('style_up_messages').insert({
    thread_id: threadId, sender: 'stylist', kind: 'render',
    render_generation_id: gen.id, product_ref: { ...caption, pieces },
  });
  await supabase.from('style_up_threads')
    .update({ last_message_at: new Date().toISOString() }).eq('id', threadId);

  return { generationId: gen.id, error: null };
}

/** "See it on me" — render the shopper wearing a single stylist pick. */
export async function startLookRender(opts: {
  threadId: string;
  shopperUserId: string;
  product: StyleUpProductRef;
}): Promise<{ generationId: string | null; error: string | null }> {
  const { threadId, shopperUserId, product } = opts;
  if (!product.id) return { generationId: null, error: "This pick can't be rendered yet." };
  return renderLook(threadId, shopperUserId, [product], product);
}

/** Render the shopper wearing the WHOLE look — every stylist pick composited
 *  head-to-toe in a single generation. Pass `replace` to swap one slot (e.g.
 *  new pants) — the old piece in that role is dropped and the new one added. */
export async function startFullLookRender(opts: {
  threadId: string;
  shopperUserId: string;
  products: StyleUpProductRef[];
  replace?: { role: string; product: StyleUpProductRef } | null;
  scene?: string | null;
}): Promise<{ generationId: string | null; error: string | null }> {
  const { threadId, shopperUserId, products, replace, scene } = opts;
  const caption: StyleUpProductRef = {
    name: replace ? 'Your updated look' : 'Your full look',
    image: replace?.product.image || products.find(p => p.image)?.image,
  };
  return renderLook(threadId, shopperUserId, products, caption, replace, scene);
}

const SWAP_FETCH_LIMIT = 240;

/** Signals that shape recommendations beyond plain recency. */
export interface RecommendOpts {
  budgetMax?: number | null;            // hard ceiling per piece
  styleText?: string | null;           // shopper's saved style + fashion tags
  occasion?: string | null;            // "date night", "work", "wedding"…
  formality?: 'dressier' | 'casual' | null; // running constraint from feedback
  avoidColors?: string[];              // colors the shopper passed on
  simpler?: boolean;                   // "keep it simple / less flashy"
  engineMethod?: StylistEngineMethod;   // 'style_engine' (default) → style_slot_search; 'legacy' → recency
}

function priceNum(s?: string | null): number | null {
  if (!s) return null;
  const m = String(s).replace(/[, ]/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}
const FORMAL_RE = /\b(blazer|suit|tuxedo|oxford|loafer|derby|brogue|trouser|slacks|tie|gown|heel|pump|silk|wool|cashmere|tailored|dress\s?shirt|chelsea)\b/;
const CASUAL_RE = /\b(hoodie|sweatshirt|tee|t-?shirt|sneaker|trainer|shorts?|jogger|sweatpant|cargo|flip[\s-]?flop|graphic|denim|jean|tank)\b/;
const LOUD_RE = /\b(print|printed|graphic|neon|sequin|leopard|floral|tie-?dye|logo|bold|bright|metallic)\b/;
const kw = (s: string): string[] => (s.toLowerCase().match(/[a-z]{4,}/g) ?? []);

type SwapRow = {
  id: string; name: string | null; brand: string | null; price: string | null;
  image_url: string | null; primary_image_url: string | null; url: string | null;
  type: string | null; haiku_context: string | null;
};

/** Occasion-aware candidates for one slot via style_slot_search (the engine).
 *  Returns rows in the same shape as the legacy recency select so the caller's
 *  scoring loop is source-agnostic. */
async function slotSearch(role: string, gender: string, occasion: string, k: number): Promise<SwapRow[]> {
  if (!supabase) return [];
  const noun = ROLE_QUERY_NOUN[role] ?? '';
  const q = `${occasion} ${noun}`.trim();
  const pGender = gender === 'male' || gender === 'female' ? gender : null;
  const { data, error } = await supabase.rpc('style_slot_search', { p_query: q, p_k: k, p_gender: pGender });
  if (error || !Array.isArray(data)) return [];
  return (data as Array<Record<string, unknown>>).map(r => ({
    id: String(r.product_id), name: (r.product_name as string) ?? null, brand: (r.product_brand as string) ?? null,
    price: (r.product_price as string) ?? null, image_url: (r.product_image_url as string) ?? null,
    primary_image_url: (r.product_image_url as string) ?? null, url: (r.product_url as string) ?? null,
    type: (r.product_type as string) ?? null, haiku_context: null,
  }));
}

/** Score + rank gender-matched, in-stock candidates for one slot (role).
 *  Folds in relevance to the shopper's style + occasion (#2), budget (#4),
 *  formality coherence + simplicity (#3), and feedback constraints (#7).
 *  Recency breaks ties. Skips excluded ids + items that violate hard limits. */
export async function fetchSwapOptions(
  shopperUserId: string,
  role: string,
  count = 3,
  excludeIds: string[] = [],
  opts: RecommendOpts = {},
): Promise<StyleUpProductRef[]> {
  if (!supabase) return [];
  const gender = await getUserGender(shopperUserId);
  const method: StylistEngineMethod = opts.engineMethod ?? 'style_engine';
  let data: SwapRow[] | null;
  if (method === 'style_engine') {
    const occasion = [opts.styleText, opts.occasion].filter(Boolean).join(' ');
    data = await slotSearch(role, gender, occasion, SWAP_FETCH_LIMIT);
  } else {
    let q = supabase.from('products')
      .select('id, name, brand, price, image_url, primary_image_url, url, type, gender, haiku_context')
      .eq('is_active', true)              // in-stock proxy (#5)
      .not('image_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(SWAP_FETCH_LIMIT);
    if (gender === 'male') q = q.or('gender.eq.male,gender.eq.unisex');
    else if (gender === 'female') q = q.or('gender.eq.female,gender.eq.unisex');
    data = (await q).data as SwapRow[] | null;
  }

  const exclude = new Set(excludeIds);
  const styleKw = kw(opts.styleText ?? '');
  const occKw = kw(opts.occasion ?? '');
  const avoid = (opts.avoidColors ?? []).map(c => c.toLowerCase());

  const scored: Array<{ ref: StyleUpProductRef; score: number; idx: number }> = [];
  let idx = 0;
  for (const p of (data ?? []) as SwapRow[]) {
    idx++;
    if (exclude.has(p.id)) continue;
    if (roleForProduct(p.type, p.name) !== role) continue;
    const text = `${p.name ?? ''} ${p.brand ?? ''} ${p.type ?? ''} ${p.haiku_context ?? ''}`.toLowerCase();
    if (avoid.some(c => text.includes(c))) continue;            // dropped color (#7)
    const price = priceNum(p.price);
    if (opts.budgetMax && price !== null && price > opts.budgetMax) continue; // budget (#4)

    let score = 0;
    for (const k of styleKw) if (text.includes(k)) score += 1;   // style relevance (#2)
    for (const k of occKw) if (text.includes(k)) score += 2;     // occasion fit (#6)
    if (opts.formality === 'casual') score += (FORMAL_RE.test(text) ? -3 : 0) + (CASUAL_RE.test(text) ? 1 : 0);
    if (opts.formality === 'dressier') score += (CASUAL_RE.test(text) ? -3 : 0) + (FORMAL_RE.test(text) ? 1 : 0);
    if (opts.simpler && LOUD_RE.test(text)) score -= 2;          // simplicity (#3)
    score += Math.max(0, 1 - idx / SWAP_FETCH_LIMIT) * 0.5;      // gentle recency tiebreak

    scored.push({
      idx,
      score,
      ref: {
        id: p.id, name: p.name ?? undefined, brand: p.brand ?? undefined, price: p.price ?? undefined,
        image: p.primary_image_url || p.image_url || undefined, url: p.url ?? undefined,
      },
    });
  }
  scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
  return scored.slice(0, count).map(s => s.ref);
}

// ── Web sourcing (web stylists, e.g. Theo) ──────────────────────────────────
// A web stylist doesn't pull from our catalog — the app searches the open web
// via product-search (Google Shopping/SerpAPI), which AUTO-IMPORTS each match
// into `products` (real ids + queued embeddings), then we return those imported
// rows as product refs. Because they now live in `products`, the exact same
// on-you render pipeline works on them unchanged.

const ROLE_QUERY_NOUN: Record<string, string> = {
  Top: 'shirt', Pants: 'pants', Jacket: 'jacket', Shoes: 'shoes', Hat: 'hat',
  Dress: 'dress', Bag: 'bag', Sunglasses: 'sunglasses', Jewelry: 'jewelry', Accessory: 'accessory',
};

function genderWord(gender: string): string {
  return gender === 'male' ? "men's" : gender === 'female' ? "women's" : '';
}

/** A few search qualifiers distilled from the running prefs + saved style, so a
 *  web query reads like a real shopper ("men's dressy minimalist jacket"). */
function webQualifiers(opts: RecommendOpts): string {
  const bits: string[] = [];
  if (opts.formality === 'dressier') bits.push('dressy');
  if (opts.formality === 'casual') bits.push('casual');
  if (opts.simpler) bits.push('minimalist');
  if (opts.occasion) bits.push(opts.occasion);
  bits.push(...kw(opts.styleText ?? '').slice(0, 2));
  return bits.join(' ');
}

/** Diagnostics for one web search — surfaced to super admins so a failed pull
 *  can be debugged (was it the search, the import, or the catalog match?). */
export interface WebSearchDiag {
  ok: boolean;          // the product-search call itself succeeded
  error: string | null; // error text when it didn't
  rawCount: number;     // results the search returned
  withUrl: number;      // of those, how many had a usable URL
  matched: number;      // how many resolved to renderable catalog rows
}

/** Search the open web for `query`, auto-import the matches, and return the
 *  imported products (now real catalog rows, so they're renderable) as refs in
 *  relevance order, capped at `count` — plus diagnostics for debugging. */
export async function webSearchProducts(
  query: string,
  gender: string,
  count = 4,
): Promise<{ products: StyleUpProductRef[]; diag: WebSearchDiag }> {
  const diag: WebSearchDiag = { ok: false, error: null, rawCount: 0, withUrl: 0, matched: 0 };
  if (!supabase || !query.trim()) { diag.error = 'no query / no db'; return { products: [], diag }; }
  const g = gender === 'male' ? 'men' : gender === 'female' ? 'women' : 'unisex';
  const { data, error } = await supabase.functions.invoke('product-search', {
    body: { query: query.trim(), ingest: true, gender: g },
  });
  const resp = data as { success?: boolean; error?: string; products?: Array<{ url?: string }> } | null;
  if (error || !resp?.success) {
    diag.error = (error as { message?: string } | null)?.message || resp?.error || 'search failed';
    return { products: [], diag };
  }
  diag.ok = true;
  // Resolve searched products → catalog rows by url (covers freshly-imported
  // AND already-existing ones). Only rows with an id can be rendered, so we key
  // off the DB rows and keep SerpAPI's order.
  const all = resp.products ?? [];
  diag.rawCount = all.length;
  const urls = all.map(p => p.url).filter((u): u is string => !!u);
  diag.withUrl = urls.length;
  if (urls.length === 0) return { products: [], diag };
  type Row = { id: string; name: string | null; brand: string | null; price: string | null; image_url: string | null; primary_image_url: string | null; url: string | null; type: string | null };
  const { data: rows } = await supabase
    .from('products')
    .select('id, name, brand, price, image_url, primary_image_url, url, type')
    .in('url', urls.slice(0, 30));
  const byUrl = new Map<string, Row>(((rows ?? []) as Row[]).map(r => [r.url ?? '', r]));
  const out: StyleUpProductRef[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    const r = byUrl.get(u);
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({
      id: r.id, name: r.name ?? undefined, brand: r.brand ?? undefined, price: r.price ?? undefined,
      image: r.primary_image_url || r.image_url || undefined, url: r.url ?? undefined,
    });
    if (out.length >= count) break;
  }
  diag.matched = out.length;
  return { products: out, diag };
}

/** One web find for the hunt + its diagnostics (for super-admin error display). */
export async function webHuntOne(
  shopperUserId: string,
  query: string,
  excludeIds: string[] = [],
): Promise<{ pick: StyleUpProductRef | null; diag: WebSearchDiag }> {
  const gender = await getUserGender(shopperUserId);
  const { products, diag } = await webSearchProducts(query, gender, 1 + excludeIds.length + 3);
  const exclude = new Set(excludeIds);
  const pick = products.find(p => p.id && !exclude.has(p.id)) ?? null;
  return { pick, diag };
}

/** Web equivalent of fetchSwapOptions — N web finds for one slot (role),
 *  honoring budget + role where the noisy web titles let us tell. */
export async function webFetchSwapOptions(
  shopperUserId: string,
  role: string,
  count = 3,
  excludeIds: string[] = [],
  opts: RecommendOpts = {},
): Promise<StyleUpProductRef[]> {
  const gender = await getUserGender(shopperUserId);
  const noun = ROLE_QUERY_NOUN[role] ?? role.toLowerCase();
  const query = [genderWord(gender), webQualifiers(opts), noun].filter(Boolean).join(' ');
  const { products: found } = await webSearchProducts(query, gender, count + excludeIds.length + 4);
  const exclude = new Set(excludeIds);
  const filtered: StyleUpProductRef[] = [];
  for (const p of found) {
    if (!p.id || exclude.has(p.id)) continue;
    const guessed = roleForProduct(null, p.name ?? null);
    if (guessed && guessed !== role) continue;          // wrong slot when we can tell
    const price = priceNum(p.price);
    if (opts.budgetMax && price !== null && price > opts.budgetMax) continue;
    filtered.push(p);
    if (filtered.length >= count) break;
  }
  // Web titles are noisy — if role filtering was too aggressive, fall back to
  // the raw finds so the shopper still gets options.
  return filtered.length ? filtered : found.filter(p => p.id && !exclude.has(p.id)).slice(0, count);
}

/** Recommend ONE web find for a slot (role). */
export async function webRecommendForSlot(
  shopperUserId: string,
  role: string,
  excludeIds: string[] = [],
  opts: RecommendOpts = {},
): Promise<StyleUpProductRef | null> {
  const [p] = await webFetchSwapOptions(shopperUserId, role, 1, excludeIds, opts);
  return p ?? null;
}

/** Post a generic tap-chooser into the thread (which shoes / which slots / …). */
export async function sendChooser(
  threadId: string,
  choose: NonNullable<StyleUpProductRef['choose']>,
): Promise<StyleUpMessage | null> {
  if (!supabase || choose.options.length === 0) return null;
  const { data, error } = await supabase
    .from('style_up_messages')
    .insert({ thread_id: threadId, sender: 'stylist', kind: 'product', product_ref: { choose } })
    .select('id, thread_id, sender, kind, body, product_ref, render_generation_id, created_at')
    .single();
  if (error || !data) return null;
  await supabase.from('style_up_threads')
    .update({ last_message_at: new Date().toISOString() }).eq('id', threadId);
  return mapMessage(data as Record<string, unknown>);
}

/** Recommend ONE product for a given slot (role), gender-matched, excluding ids
 *  already shown/used. Used by the outfit flow to fill chosen slots. */
export async function recommendForSlot(
  shopperUserId: string,
  role: string,
  excludeIds: string[] = [],
  opts: RecommendOpts = {},
): Promise<StyleUpProductRef | null> {
  const [pick] = await fetchSwapOptions(shopperUserId, role, 1, excludeIds, opts);
  return pick ?? null;
}

/** Post a single product pick into the thread (the stylist recommending). */
export async function sendProductPick(
  threadId: string,
  product: StyleUpProductRef,
): Promise<StyleUpMessage | null> {
  if (!supabase || !product.id) return null;
  const { data, error } = await supabase
    .from('style_up_messages')
    .insert({ thread_id: threadId, sender: 'stylist', kind: 'product', product_ref: product })
    .select('id, thread_id, sender, kind, body, product_ref, render_generation_id, created_at')
    .single();
  if (error || !data) return null;
  await supabase.from('style_up_threads')
    .update({ last_message_at: new Date().toISOString() }).eq('id', threadId);
  return mapMessage(data as Record<string, unknown>);
}

/** Post a swap picker into the thread — a `product` message whose product_ref
 *  carries the alternative options for one slot. */
export async function sendSwapOptions(
  threadId: string,
  role: string,
  label: string,
  options: StyleUpProductRef[],
): Promise<StyleUpMessage | null> {
  if (!supabase || options.length === 0) return null;
  const { data, error } = await supabase
    .from('style_up_messages')
    .insert({ thread_id: threadId, sender: 'stylist', kind: 'product', product_ref: { swap: { role, label, options } } })
    .select('id, thread_id, sender, kind, body, product_ref, render_generation_id, created_at')
    .single();
  if (error || !data) return null;
  await supabase.from('style_up_threads')
    .update({ last_message_at: new Date().toISOString() }).eq('id', threadId);
  return mapMessage(data as Record<string, unknown>);
}
