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
): Promise<{ generationId: string | null; error: string | null }> {
  if (!supabase) return { generationId: null, error: 'No database connection' };

  const withId = picks.filter(p => !!p.id).slice(0, MAX_LOOK_PIECES);
  if (withId.length === 0) return { generationId: null, error: "These picks can't be rendered yet." };

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
  const ids = withId.map(p => p.id as string);
  const { data: rows } = await supabase
    .from('products').select('id, type, name, brand').in('id', ids);
  const byId = new Map(((rows ?? []) as Array<{ id: string; type: string | null; name: string | null; brand: string | null }>).map(r => [r.id, r]));

  const lines = withId.map(p => {
    const row = byId.get(p.id as string);
    const name = row?.name ?? p.name ?? null;
    const brand = row?.brand ?? p.brand ?? null;
    const roleTag = roleForProduct(row?.type ?? null, name);
    return { product_id: p.id as string, roleTag, name, brand };
  });

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

  await supabase.from('style_up_messages').insert({
    thread_id: threadId, sender: 'stylist', kind: 'render',
    render_generation_id: gen.id, product_ref: caption,
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
 *  head-to-toe in a single generation. */
export async function startFullLookRender(opts: {
  threadId: string;
  shopperUserId: string;
  products: StyleUpProductRef[];
}): Promise<{ generationId: string | null; error: string | null }> {
  const { threadId, shopperUserId, products } = opts;
  const caption: StyleUpProductRef = {
    name: 'Your full look',
    image: products.find(p => p.image)?.image,
  };
  return renderLook(threadId, shopperUserId, products, caption);
}
