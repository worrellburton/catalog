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

export interface StyleUpStylist {
  id: string;
  name: string;
  avatarUrl: string | null;
  specialty: string | null;
  bio: string | null;
  accentColor: string | null;
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
    accentColor: (r.accent_color as string | null) ?? null,
  };
}

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

/** The active stylist roster, in display order. */
export async function fetchStylists(): Promise<StyleUpStylist[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('style_up_stylists')
    .select('id, name, avatar_url, specialty, bio, accent_color')
    .eq('is_active', true)
    .order('sort', { ascending: true });
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
    .select('id, last_message_at, stylist:style_up_stylists(id, name, avatar_url, specialty, bio, accent_color)')
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
    .select('id, shopper_user_id, last_message_at, stylist:style_up_stylists(id, name, avatar_url, specialty, bio, accent_color)')
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
    supabase.from('style_up_threads').select('id, shopper_user_id, stylist:style_up_stylists(id, name, avatar_url, specialty, bio, accent_color)').in('id', threadIds.length ? threadIds : ['00000000-0000-0000-0000-000000000000']),
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
    .select('id, stylist:style_up_stylists(id, name, avatar_url, specialty, bio, accent_color)')
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
): Promise<{ generationId: string | null; error: string | null }> {
  if (!supabase) return { generationId: null, error: 'No database connection' };

  const withId = picks.filter(p => !!p.id).slice(0, MAX_LOOK_PIECES);
  // The replacement piece must be renderable even if the base set was empty.
  if (withId.length === 0 && !replace?.product.id) {
    return { generationId: null, error: "These picks can't be rendered yet." };
  }

  const [ha, gender, customStyle, slots] = await Promise.all([
    getUserHeightAge(shopperUserId),
    getUserGender(shopperUserId),
    getUserCustomStyle(shopperUserId),
    getUserSlots(shopperUserId, MAX_REF_PHOTOS),
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

  const prompt = buildGenerationPrompt({
    heightLabel: ha.heightLabel ?? '',
    weightLabel: ha.weightLabel,
    ageLabel: ha.ageLabel ?? undefined,
    style: 'editorial',
    customStyle,
    gender,
    productLines: lines.map(l => ({ role_tag: l.roleTag, brand: l.brand, name: l.name })),
    durationSeconds: 10,
  });

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
    durationSeconds: 10,
    model: 'pro',
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
}): Promise<{ generationId: string | null; error: string | null }> {
  const { threadId, shopperUserId, products, replace } = opts;
  const caption: StyleUpProductRef = {
    name: replace ? 'Your updated look' : 'Your full look',
    image: replace?.product.image || products.find(p => p.image)?.image,
  };
  return renderLook(threadId, shopperUserId, products, caption, replace);
}

const SWAP_FETCH_LIMIT = 200;

/** Fetch a few alternative products for one slot (role), gender-matched, to
 *  offer the shopper a swap. Skips ids already in the look. */
export async function fetchSwapOptions(
  shopperUserId: string,
  role: string,
  count = 3,
  excludeIds: string[] = [],
): Promise<StyleUpProductRef[]> {
  if (!supabase) return [];
  const gender = await getUserGender(shopperUserId);
  let q = supabase.from('products')
    .select('id, name, brand, price, image_url, primary_image_url, url, type, gender')
    .eq('is_active', true)
    .not('image_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(SWAP_FETCH_LIMIT);
  if (gender === 'male') q = q.or('gender.eq.male,gender.eq.unisex');
  else if (gender === 'female') q = q.or('gender.eq.female,gender.eq.unisex');
  const { data } = await q;
  const exclude = new Set(excludeIds);
  const out: StyleUpProductRef[] = [];
  for (const p of (data ?? []) as Array<{ id: string; name: string | null; brand: string | null; price: string | null; image_url: string | null; primary_image_url: string | null; url: string | null; type: string | null }>) {
    if (exclude.has(p.id)) continue;
    if (roleForProduct(p.type, p.name) !== role) continue;
    out.push({
      id: p.id, name: p.name ?? undefined, brand: p.brand ?? undefined, price: p.price ?? undefined,
      image: p.primary_image_url || p.image_url || undefined, url: p.url ?? undefined,
    });
    if (out.length >= count) break;
  }
  return out;
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
): Promise<StyleUpProductRef | null> {
  const [pick] = await fetchSwapOptions(shopperUserId, role, 1, excludeIds);
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
