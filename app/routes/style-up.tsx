// Style Up — AI stylist chat, a consumer app feature. A shopper requests a
// stylist from the roster, then chats iMessage-style; the stylist (AI) sends
// product picks + on-you renders. The shopper's AI-look context rides at the
// top, read-only, so the stylist always sees who it's styling.
//
// Full-screen consumer page (dark). Roster → open/resume a thread → context
// card + live message list + composer. The AI stylist replies (style-up-chat
// edge fn), product picks, and "see it on me" renders (generate-look pipeline)
// stream in via realtime.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { useAuth } from '~/hooks/useAuth';
import { supabase } from '~/utils/supabase';
import {
  fetchStylists, getOrCreateThread, getLatestThread, fetchMyThreads, fetchMessages, sendShopperMessage,
  sendStylistText, startLookRender, startFullLookRender, fetchSwapOptions, sendSwapOptions,
  type StyleUpStylist, type StyleUpMessage, type StyleUpProductRef, type StyleUpThreadSummary,
} from '~/services/style-up';
import { getUserHeightAge, getUserCustomStyle, updateUserHeightAge, updateUserCustomStyle } from '~/services/profiles';
import { getUserGender, updateUserGender, type UserGender } from '~/services/genders';
import {
  listUserUploads, getUserSlots, saveUserSlots, uploadUserPhoto, getGeneration,
  type UserGeneration,
} from '~/services/user-generations';
import { promoteGenerationToLook } from '~/services/promote-generation';
import { generationProgress } from '~/services/generation-progress';
import '~/styles/style-up.css';

/** "~2 min left" / "~40s left" — estimated wait from the shared generation
 *  timing model (based on typical generation durations). */
function fmtRemaining(sec: number): string {
  if (sec <= 0) return 'almost done…';
  if (sec < 60) return `~${sec}s left`;
  return `~${Math.ceil(sec / 60)} min left`;
}

/** Does this shopper message read as "put the whole look on me"? Detected
 *  client-side so the existing generate-look pipeline can fire without waiting
 *  on the AI turn (and without it claiming it "can't generate photos"). */
function wantsFullLook(text: string): boolean {
  const t = text.toLowerCase();
  const onMe = /\bon me\b|\bon myself\b|\bon my body\b/.test(t);
  const lookWord = /\b(look|outfit|fit|ensemble|whole thing|all of (it|this|these|them)|these|this|it|them)\b/.test(t);
  const verb = /\b(generate|make|create|show|see|put|try|render|build|style|dress|model)\b/.test(t);
  if (onMe && lookWord) return true;
  if (verb && /\b(whole|full|entire|complete)\b[^.?!]*\b(look|outfit|fit)\b/.test(t)) return true;
  if (/\b(generate|make|create|build|render|show)\b[^.?!]*\b(the|this|that|a|my|your)\b[^.?!]*\b(look|outfit|fit)\b/.test(t)) return true;
  return false;
}

/** Does this message ask to swap one slot ("try different pants")? Returns the
 *  target role (ROLE_TAG) + a friendly label, or null. */
function swapTargetFromText(text: string): { role: string; label: string } | null {
  const t = text.toLowerCase();
  const change = /\b(different|another|other|swap|change|switch|new|alternativ\w*|else|instead|try|replace)\b/.test(t);
  if (!change) return null;
  if (/\b(pant|pants|trouser|trousers|jean|jeans|denim|chino|chinos|bottom|bottoms|slacks|short|shorts)\b/.test(t)) return { role: 'Pants', label: 'pants' };
  if (/\b(shoe|shoes|sneaker|sneakers|boot|boots|loafer|loafers|footwear|heel|heels|sandal|sandals|trainer|trainers)\b/.test(t)) return { role: 'Shoes', label: 'shoes' };
  if (/\b(jacket|jackets|coat|coats|blazer|blazers|outerwear|parka|overcoat|bomber)\b/.test(t)) return { role: 'Jacket', label: 'jacket' };
  if (/\b(top|tops|shirt|shirts|tee|tees|t-shirt|tshirt|sweater|sweaters|knit|polo|blouse|sweatshirt|henley)\b/.test(t)) return { role: 'Top', label: 'top' };
  if (/\b(dress|dresses|gown)\b/.test(t)) return { role: 'Dress', label: 'dress' };
  if (/\b(hat|hats|cap|caps|beanie)\b/.test(t)) return { role: 'Hat', label: 'hat' };
  if (/\b(bag|bags|tote|backpack|purse|handbag)\b/.test(t)) return { role: 'Bag', label: 'bag' };
  if (/\b(sunglass\w*|shades|eyewear)\b/.test(t)) return { role: 'Sunglasses', label: 'sunglasses' };
  if (/\b(watch|jewelry|jewellery|necklace|bracelet|ring|earring|earrings)\b/.test(t)) return { role: 'Jewelry', label: 'jewelry' };
  return null;
}

/** The stylist's warm description + feedback prompt once the look is rendered. */
function describeLook(products: StyleUpProductRef[]): string {
  const names = products.map(p => p.brand || p.name).filter(Boolean).slice(0, 4) as string[];
  const list = names.length ? names.join(', ') : 'the pieces we picked';
  return `Here's the full look on you — ${list}. I kept it cohesive and true to your vibe. How do you like it? Want to adjust anything — different pants, a fresh top, another shoe? Just say the word and I'll swap it.`;
}

const MAX_PHOTOS = 3;

interface ShopperContext {
  photos: (string | null)[];  // resolved URL per slot (null = empty), length MAX_PHOTOS
  slots: (string | null)[];   // upload id per slot (length MAX_PHOTOS)
  heightLabel: string;
  weightLabel: string;
  ageLabel: string;
  gender: UserGender;
  style: string;
  chips: string[];
}

function initials(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

/** Compact relative time for the conversation list (now / 3h / 2d / Jun 8). */
function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function StyleUpPage() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const navigate = useNavigate();

  const [stylists, setStylists] = useState<StyleUpStylist[]>([]);
  const [active, setActive] = useState<StyleUpStylist | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StyleUpMessage[]>([]);
  const [latestThread, setLatestThread] = useState<{ threadId: string; stylist: StyleUpStylist } | null>(null);
  const [myThreads, setMyThreads] = useState<StyleUpThreadSummary[]>([]);
  const [bootResumed, setBootResumed] = useState(false);
  const [opening, setOpening] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [stylistTyping, setStylistTyping] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [ctx, setCtx] = useState<ShopperContext | null>(null);
  const [ctxMini, setCtxMini] = useState(false);     // collapse-on-scroll
  const [ctxEditing, setCtxEditing] = useState(false);
  // Render polling: generation id → its latest row. Drives the on-you render
  // bubbles (spinner → video).
  const [renders, setRenders] = useState<Record<string, UserGeneration>>({});
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderingIds, setRenderingIds] = useState<Set<string>>(new Set());
  const [genLook, setGenLook] = useState(false);     // full-look render in flight
  const [published, setPublished] = useState<Set<string>>(new Set()); // gen ids added to looks
  const [followedUp, setFollowedUp] = useState<Set<string>>(new Set()); // renders the stylist has reacted to
  const [, setNowTick] = useState(0);                // 1s heartbeat for the render ETA
  const [edit, setEdit] = useState<{ heightLabel: string; weightLabel: string; ageLabel: string; gender: UserGender; style: string } | null>(null);
  const [savingCtx, setSavingCtx] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  const photoSlotRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const exit = useCallback(() => {
    // Return to wherever the shopper came from; fall back to home.
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  }, [navigate]);

  // Roster.
  useEffect(() => { void fetchStylists().then(setStylists); }, []);

  // Shopper context — the SAME inputs the AI-look flow uses (face photos +
  // height / weight / age / gender + saved style). Editable here; saving writes
  // straight to the profile the stylist reads each turn, so it stays in sync
  // with the AI-look studio (one source of truth).
  const loadContext = useCallback(async () => {
    if (!userId) return;
    const [ha, gender, style, uploads, slots] = await Promise.all([
      getUserHeightAge(userId),
      getUserGender(userId),
      getUserCustomStyle(userId),
      listUserUploads(userId),
      getUserSlots(userId, MAX_PHOTOS),
    ]);
    const byId = new Map(uploads.map(u => [u.id, u.public_url]));
    let normSlots = slots.slice(0, MAX_PHOTOS);
    while (normSlots.length < MAX_PHOTOS) normSlots.push(null);
    // Fall back to most-recent uploads when no explicit slots are set.
    if (!normSlots.some(Boolean) && uploads.length) {
      normSlots = uploads.slice(0, MAX_PHOTOS).map(u => u.id);
      while (normSlots.length < MAX_PHOTOS) normSlots.push(null);
    }
    const photos = normSlots.map(id => (id ? byId.get(id) ?? null : null));
    const chips: string[] = [];
    if (ha.heightLabel) chips.push(ha.heightLabel);
    if (ha.weightLabel) chips.push(ha.weightLabel.replace(/\s*\(.*\)\s*/, ''));
    if (ha.ageLabel) chips.push(ha.ageLabel);
    if (gender !== 'unknown') chips.push(gender);
    setCtx({
      photos, slots: normSlots,
      heightLabel: ha.heightLabel ?? '', weightLabel: ha.weightLabel ?? '', ageLabel: ha.ageLabel ?? '',
      gender, style: style ?? '', chips,
    });
  }, [userId]);
  useEffect(() => { void loadContext(); }, [loadContext]);

  // Open a known thread (resume) — loads its full history so the conversation
  // keeps going where it left off.
  const openThread = useCallback(async (id: string, s: StyleUpStylist) => {
    setActive(s);
    setThreadId(id);
    setLatestThread({ threadId: id, stylist: s });
    setMessages(await fetchMessages(id));
  }, []);

  // Open (or resume) a thread with the chosen stylist from the roster.
  const openStylist = useCallback(async (s: StyleUpStylist) => {
    if (!userId || opening) return;
    setOpening(true);
    setActive(s);
    const id = await getOrCreateThread(s.id, userId);
    if (id) await openThread(id, s);
    setOpening(false);
  }, [userId, opening, openThread]);

  // Resume the most-recent active chat (the upper-right chat icon).
  const resumeLatest = useCallback(() => {
    if (latestThread) void openThread(latestThread.threadId, latestThread.stylist);
  }, [latestThread, openThread]);

  // Load the shopper's saved conversations (for the roster list).
  const loadThreads = useCallback(async () => {
    if (!userId) return;
    setMyThreads(await fetchMyThreads(userId));
  }, [userId]);

  const closeThread = useCallback(() => {
    setThreadId(null);
    setActive(null);
    setMessages([]);
    setDraft('');
    void loadThreads(); // refresh the saved-conversations list with the latest
  }, [loadThreads]);

  // On open, resume the shopper's most-recent conversation so an active chat's
  // history keeps going instead of dropping them back on the roster every time.
  useEffect(() => {
    if (!userId || bootResumed) return;
    let cancelled = false;
    (async () => {
      const [latest] = await Promise.all([getLatestThread(userId), loadThreads()]);
      if (cancelled) return;
      setBootResumed(true);
      if (latest) {
        setLatestThread(latest);
        await openThread(latest.threadId, latest.stylist);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, bootResumed, openThread, loadThreads]);

  // Realtime: new messages (either side) stream into the open thread.
  useEffect(() => {
    if (!threadId || !supabase) return;
    const channel = supabase
      .channel(`style-up-thread-${threadId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'style_up_messages', filter: `thread_id=eq.${threadId}` },
        (payload) => {
          const r = payload.new as Record<string, unknown>;
          const msg: StyleUpMessage = {
            id: String(r.id), threadId: String(r.thread_id),
            sender: (r.sender as StyleUpMessage['sender']) ?? 'stylist',
            kind: (r.kind as StyleUpMessage['kind']) ?? 'text',
            body: (r.body as string | null) ?? null,
            productRef: (r.product_ref as StyleUpMessage['productRef']) ?? null,
            renderGenerationId: (r.render_generation_id as string | null) ?? null,
            createdAt: String(r.created_at),
          };
          setMessages(prev => (prev.some(m => m.id === msg.id) ? prev : [...prev, msg]));
        })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [threadId]);

  // Keep the chat pinned to the latest message.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, stylistTyping]);

  // Kick the AI stylist for the current thread. Its reply (+ any product picks)
  // streams back via the realtime subscription; the typing bubble holds until
  // the call resolves. Any failure surfaces a recoverable error row with a
  // retry, rather than silently dropping the turn.
  const triggerStylist = useCallback(async () => {
    if (!threadId || !supabase) return;
    setChatError(null);
    setStylistTyping(true);
    try {
      const { data, error } = await supabase.functions.invoke('style-up-chat', { body: { threadId } });
      const resp = data as { success?: boolean; error?: string } | null;
      if (error || !resp?.success) {
        setChatError(resp?.error || 'Your stylist couldn’t respond. Tap to retry.');
      }
    } catch {
      setChatError('Your stylist couldn’t respond. Tap to retry.');
    } finally {
      setStylistTyping(false);
    }
  }, [threadId]);

  // "Generate the look on me" — the stylist confirms in-thread, then the FULL
  // set of recommended pieces is composited onto the shopper via the existing
  // generate-look pipeline. The render bubble streams in + polls to the video.
  const generateFullLook = useCallback(async (products: StyleUpProductRef[]) => {
    if (!threadId || !userId || genLook) return;
    const seen = new Set<string>();
    const uniq = products.filter(p => {
      if (!p.id || seen.has(p.id)) return false;
      seen.add(p.id); return true;
    });
    if (uniq.length === 0) { void triggerStylist(); return; }
    setGenLook(true);
    setRenderError(null);
    await sendStylistText(threadId, "Love it — putting your full look together now. I'll send it over the second it's ready ✨");
    const { error } = await startFullLookRender({ threadId, shopperUserId: userId, products: uniq });
    if (error) {
      setRenderError(error);
      await sendStylistText(threadId, `Hmm, I couldn't start that render — ${error}`);
    }
    setGenLook(false);
  }, [threadId, userId, genLook, triggerStylist]);

  // The pieces currently in the look — the stylist's product picks, excluding
  // swap pickers. Drives full-look generation + swap re-renders.
  const lookPicks = useCallback((): StyleUpProductRef[] => messages
    .filter(m => m.kind === 'product' && m.productRef?.id && !m.productRef?.swap)
    .map(m => m.productRef as StyleUpProductRef), [messages]);

  // "Try different pants" — the stylist offers 3 alternatives for that slot.
  const handleSwapRequest = useCallback(async (swap: { role: string; label: string }) => {
    if (!threadId || !userId) return;
    setRenderError(null);
    await sendStylistText(threadId, `Sure thing — here are a few ${swap.label} options. Tap the one you like and I'll put it on you.`);
    const exclude = lookPicks().map(p => p.id).filter((x): x is string => !!x);
    const options = await fetchSwapOptions(userId, swap.role, 3, exclude);
    if (options.length === 0) {
      await sendStylistText(threadId, `Hmm, I'm short on alternate ${swap.label} right now — want to try a different piece?`);
      return;
    }
    await sendSwapOptions(threadId, swap.role, swap.label, options);
  }, [threadId, userId, lookPicks]);

  // Shopper picked one of the swap options → re-render the full look with it.
  const selectSwapOption = useCallback(async (role: string, chosen: StyleUpProductRef) => {
    if (!threadId || !userId || genLook) return;
    setGenLook(true);
    setRenderError(null);
    await sendStylistText(threadId, `Great pick — restyling you with the ${chosen.brand || chosen.name || 'new piece'} now ✨`);
    const { error } = await startFullLookRender({ threadId, shopperUserId: userId, products: lookPicks(), replace: { role, product: chosen } });
    if (error) {
      setRenderError(error);
      await sendStylistText(threadId, `Couldn't render that — ${error}`);
    }
    setGenLook(false);
  }, [threadId, userId, genLook, lookPicks]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !threadId || sending) return;
    setSending(true);
    setDraft('');
    const msg = await sendShopperMessage(threadId, text);
    if (msg) setMessages(prev => (prev.some(m => m.id === msg.id) ? prev : [...prev, msg]));
    setSending(false);
    // Routing: a swap request ("different pants") → offer 3 options; a
    // whole-look request → generate; otherwise let the AI stylist take the turn.
    const swap = swapTargetFromText(text);
    const looks = lookPicks();
    if (swap && looks.length > 0) void handleSwapRequest(swap);
    else if (wantsFullLook(text) && looks.length > 0) void generateFullLook(looks);
    else void triggerStylist();
  }, [draft, threadId, sending, triggerStylist, generateFullLook, handleSwapRequest, lookPicks]);

  // Add a finished render to the shopper's own looks — promotes the generation
  // to a LIVE look (with its video + poster + pieces), associated with THIS
  // shopper, so it lands in My Catalog properly (not stuck Inactive/posterless).
  const addToLooks = useCallback(async (genId: string, pieces: StyleUpProductRef[]) => {
    if (!userId || published.has(genId)) return;
    const r = renders[genId];
    if (!r?.video_url) { setRenderError('Give it a moment to finish, then add it.'); return; }
    setPublished(prev => new Set(prev).add(genId));
    try {
      await promoteGenerationToLook({
        generationId: genId,
        creatorUserId: userId, // associate the look with this shopper
        videoUrl: r.video_url,
        creatorLabel: user?.displayName || user?.email?.split('@')[0] || 'My',
        style: 'editorial',
        gender: ctx?.gender === 'male' ? 'men' : ctx?.gender === 'female' ? 'women' : 'unisex',
        products: pieces.map(p => p.id).filter((id): id is string => !!id).map(id => ({ id })),
        status: 'live',
        titleOverride: 'My StyleUp look',
      });
    } catch (e) {
      setPublished(prev => { const n = new Set(prev); n.delete(genId); return n; });
      setRenderError(e instanceof Error ? e.message : 'Could not add to your looks.');
    }
  }, [published, renders, userId, user, ctx]);

  // "See it on me" — render the shopper wearing a stylist pick (reuses the
  // generate-look pipeline). The render bubble arrives via realtime and the
  // polling effect below carries it to the finished video.
  const tryOn = useCallback(async (product: StyleUpMessage['productRef']) => {
    if (!threadId || !userId || !product) return;
    const key = product.id || product.url || product.name || '';
    if (renderingIds.has(key)) return;
    setRenderingIds(prev => new Set(prev).add(key));
    setRenderError(null);
    const { error } = await startLookRender({ threadId, shopperUserId: userId, product });
    if (error) setRenderError(error);
    setRenderingIds(prev => { const n = new Set(prev); n.delete(key); return n; });
  }, [threadId, userId, renderingIds]);

  // Poll any in-flight render generations referenced by the thread until they
  // reach a terminal state, so the render bubbles promote spinner → video.
  useEffect(() => {
    const ids = messages
      .filter(m => m.kind === 'render' && m.renderGenerationId)
      .map(m => m.renderGenerationId as string);
    const pending = ids.filter(id => {
      const r = renders[id];
      return !r || (r.status !== 'done' && r.status !== 'failed');
    });
    if (pending.length === 0) return;
    let cancelled = false;
    const tick = async () => {
      const rows = await Promise.all(pending.map(id => getGeneration(id)));
      if (cancelled) return;
      setRenders(prev => {
        const next = { ...prev };
        rows.forEach(r => { if (r) next[r.id] = r; });
        return next;
      });
    };
    void tick();
    const h = window.setInterval(tick, 3000);
    return () => { cancelled = true; window.clearInterval(h); };
  }, [messages, renders]);

  // 1s heartbeat while any render is in-flight so the ETA countdown ticks down.
  useEffect(() => {
    const pending = messages.some(m => {
      if (m.kind !== 'render') return false;
      const r = m.renderGenerationId ? renders[m.renderGenerationId] : null;
      return !r || (r.status !== 'done' && r.status !== 'failed');
    });
    if (!pending) return;
    const h = window.setInterval(() => setNowTick(t => t + 1), 1000);
    return () => window.clearInterval(h);
  }, [messages, renders]);

  // When a render finishes AND it's the latest message, the stylist follows up
  // with a description + asks how they like it (once per render). Gated on the
  // render being last so it never double-posts (on reload the follow-up already
  // sits after it).
  useEffect(() => {
    if (!threadId || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.kind !== 'render' || !last.renderGenerationId) return;
    if (followedUp.has(last.renderGenerationId)) return;
    if (renders[last.renderGenerationId]?.status !== 'done') return;
    const gid = last.renderGenerationId;
    setFollowedUp(prev => new Set(prev).add(gid));
    void sendStylistText(threadId, describeLook(lookPicks()));
  }, [messages, renders, threadId, followedUp, lookPicks]);

  // ── Context editing — writes straight to the profile (shared with the
  // AI-look studio), so edits here show up everywhere. ──────────────────────
  const beginEdit = useCallback(() => {
    if (!ctx) return;
    setEdit({ heightLabel: ctx.heightLabel, weightLabel: ctx.weightLabel, ageLabel: ctx.ageLabel, gender: ctx.gender, style: ctx.style });
    setCtxEditing(true);
    setCtxMini(false);
  }, [ctx]);
  const cancelEdit = useCallback(() => { setCtxEditing(false); setEdit(null); }, []);
  const saveCtx = useCallback(async () => {
    if (!userId || !edit) return;
    setSavingCtx(true);
    await Promise.all([
      updateUserHeightAge(userId, { heightLabel: edit.heightLabel || null, weightLabel: edit.weightLabel || null, ageLabel: edit.ageLabel || null }),
      updateUserGender(userId, edit.gender),
      updateUserCustomStyle(userId, edit.style),
    ]);
    await loadContext();
    setSavingCtx(false);
    setCtxEditing(false);
    setEdit(null);
  }, [userId, edit, loadContext]);
  const pickPhoto = useCallback((slot: number) => {
    photoSlotRef.current = slot;
    fileInputRef.current?.click();
  }, []);
  const onPhotoFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !userId || !ctx) return;
    const slot = photoSlotRef.current;
    setUploadingSlot(slot);
    const { data, error } = await uploadUserPhoto(file, userId);
    if (!error && data) {
      const slots = [...ctx.slots];
      while (slots.length < MAX_PHOTOS) slots.push(null);
      slots[slot] = data.id;
      await saveUserSlots(userId, slots);
      await loadContext();
    }
    setUploadingSlot(null);
  }, [userId, ctx, loadContext]);

  const filledPhotos = (ctx?.photos ?? []).filter((u): u is string => !!u);
  const contextCard = (
    <div className={`su-context${ctxMini && !ctxEditing ? ' su-context--mini' : ''}${ctxEditing ? ' su-context--editing' : ''}`} aria-label="Your styling context">
      {ctxMini && !ctxEditing ? (
        // Collapsed slim bar — tap to expand back to the full card.
        <button type="button" className="su-context-minibar" onClick={() => { setCtxMini(false); if (scrollerRef.current) scrollerRef.current.scrollTop = 0; }}>
          <span className="su-context-mini-photo" aria-hidden="true">
            {filledPhotos[0] ? <img src={filledPhotos[0]} alt="" /> : 'You'}
          </span>
          <span className="su-context-mini-chips">{ctx?.chips.length ? ctx.chips.join(' · ') : 'Add your stats'}</span>
          <svg className="su-context-mini-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      ) : ctxEditing && edit ? (
        // Inline editor — photos + stats + gender + style, saved to the profile.
        <div className="su-context-editor">
          <div className="su-context-photos su-context-photos--edit">
            {[0, 1, 2].map(i => (
              <button type="button" key={i} className="su-context-photo su-context-photo--edit" onClick={() => pickPhoto(i)} aria-label={`Photo ${i + 1}`}>
                {uploadingSlot === i
                  ? <span className="su-render-spinner" aria-hidden="true" />
                  : ctx?.photos[i]
                    ? <img src={ctx.photos[i] as string} alt="" />
                    : <span className="su-context-photo-add" aria-hidden="true">+</span>}
              </button>
            ))}
          </div>
          <div className="su-edit-fields">
            <div className="su-edit-row">
              <input className="su-edit-input" placeholder="Height (e.g. 6'1&quot;)" value={edit.heightLabel} onChange={e => setEdit({ ...edit, heightLabel: e.target.value })} />
              <input className="su-edit-input" placeholder="Weight" value={edit.weightLabel} onChange={e => setEdit({ ...edit, weightLabel: e.target.value })} />
            </div>
            <div className="su-edit-row">
              <input className="su-edit-input" placeholder="Age (e.g. Late 30s)" value={edit.ageLabel} onChange={e => setEdit({ ...edit, ageLabel: e.target.value })} />
              <div className="su-edit-gender">
                {(['male', 'female'] as const).map(g => (
                  <button type="button" key={g} className={`su-edit-gender-btn${edit.gender === g ? ' is-on' : ''}`} onClick={() => setEdit({ ...edit, gender: g })}>{g === 'male' ? 'Male' : 'Female'}</button>
                ))}
              </div>
            </div>
            <textarea className="su-edit-style" placeholder="Your style (e.g. quiet luxury, tailored, neutral tones)" value={edit.style} maxLength={400} onChange={e => setEdit({ ...edit, style: e.target.value })} />
            <div className="su-edit-actions">
              <button type="button" className="su-edit-btn" onClick={cancelEdit} disabled={savingCtx}>Cancel</button>
              <button type="button" className="su-edit-btn su-edit-btn--save" onClick={() => void saveCtx()} disabled={savingCtx}>{savingCtx ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      ) : (
        // Full card.
        <>
          <div className="su-context-photos">
            {filledPhotos.length > 0
              ? filledPhotos.map((src, i) => (
                  <span className="su-context-photo" key={i}><img src={src} alt="" loading="lazy" /></span>
                ))
              : <span className="su-context-photo su-context-photo--empty" aria-hidden="true" />}
          </div>
          <div className="su-context-meta">
            <div className="su-context-title">You</div>
            <div className="su-context-chips">
              {ctx && ctx.chips.length > 0
                ? ctx.chips.map((c, i) => <span className="su-context-chip" key={i}>{c}</span>)
                : <span className="su-context-chip su-context-chip--muted">No stats yet</span>}
              {ctx?.style && <span className="su-context-chip su-context-chip--style">{ctx.style}</span>}
            </div>
            <div className="su-context-note">Your stylist sees this — keep it current.</div>
          </div>
          <button type="button" className="su-context-edit" onClick={beginEdit} aria-label="Edit your context">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
          </button>
        </>
      )}
      <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onPhotoFile} />
    </div>
  );

  // Not signed in — prompt to sign in (Style Up is per-shopper).
  if (!userId) {
    return (
      <div className="su-shell">
        <div className="su-shell-head">
          <div className="su-shell-head-left">
            <button type="button" className="su-back" onClick={exit} aria-label="Back">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <span className="su-shell-title">StyleUp</span>
          </div>
          {latestThread && (
            <button type="button" className="su-back" onClick={resumeLatest} aria-label="Open your chat">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            </button>
          )}
        </div>
        <div className="su-signin">
          <p>Sign in to chat with a stylist and see picks on yourself.</p>
        </div>
      </div>
    );
  }

  // ── Roster ────────────────────────────────────────────────────────────
  if (!threadId) {
    return (
      <div className="su-shell">
        <div className="su-shell-head">
          <div className="su-shell-head-left">
            <button type="button" className="su-back" onClick={exit} aria-label="Back">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <span className="su-shell-title">StyleUp</span>
          </div>
          {latestThread && (
            <button type="button" className="su-back" onClick={resumeLatest} aria-label="Open your chat">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            </button>
          )}
        </div>
        <div className="su-page">
          {/* Saved conversations — the shopper's ongoing chats live here so they
              can pick any one back up where they left off. */}
          {myThreads.length > 0 && (
            <div className="su-convos">
              <div className="su-section-label">Your conversations</div>
              {myThreads.map(t => (
                <button
                  key={t.threadId}
                  type="button"
                  className="su-convo-card"
                  style={{ ['--su-accent' as string]: t.stylist.accentColor ?? '#8aa0c0' }}
                  onClick={() => void openThread(t.threadId, t.stylist)}
                >
                  <span className="su-stylist-avatar" aria-hidden="true">
                    {t.stylist.avatarUrl ? <img src={t.stylist.avatarUrl} alt="" /> : initials(t.stylist.name)}
                  </span>
                  <span className="su-convo-info">
                    <span className="su-convo-top">
                      <span className="su-stylist-name">{t.stylist.name}</span>
                      <span className="su-convo-time">{relativeTime(t.lastMessageAt)}</span>
                    </span>
                    {t.lastMessage && <span className="su-convo-preview">{t.lastMessage}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="su-roster-head">
            <h1>{myThreads.length > 0 ? 'Find another stylist' : 'Find your stylist'}</h1>
            <p>Request a stylist. They&apos;ll learn your vibe, send picks, and show you wearing them.</p>
          </div>
          <div className="su-roster">
            {stylists.filter(s => !myThreads.some(t => t.stylist.id === s.id)).map(s => (
              <button
                key={s.id}
                type="button"
                className="su-stylist-card"
                style={{ ['--su-accent' as string]: s.accentColor ?? '#8aa0c0' }}
                onClick={() => void openStylist(s)}
                disabled={opening}
              >
                <span className="su-stylist-avatar" aria-hidden="true">
                  {s.avatarUrl ? <img src={s.avatarUrl} alt="" /> : initials(s.name)}
                </span>
                <span className="su-stylist-info">
                  <span className="su-stylist-name">{s.name}</span>
                  {s.specialty && <span className="su-stylist-specialty">{s.specialty}</span>}
                  {s.bio && <span className="su-stylist-bio">{s.bio}</span>}
                </span>
                <span className="su-stylist-cta">Request</span>
              </button>
            ))}
            {stylists.length === 0 && <div className="su-empty">No stylists available yet.</div>}
            {stylists.length > 0 && stylists.every(s => myThreads.some(t => t.stylist.id === s.id)) && (
              <div className="su-empty">You&apos;re chatting with all our stylists.</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Thread ────────────────────────────────────────────────────────────
  return (
    <div className="su-shell" style={{ ['--su-accent' as string]: active?.accentColor ?? '#8aa0c0' }}>
      <div className="su-page su-page--thread">
        <div className="su-thread-head">
          <button type="button" className="su-back" onClick={closeThread} aria-label="Back to stylists">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <span className="su-thread-avatar" aria-hidden="true">
            {active?.avatarUrl ? <img src={active.avatarUrl} alt="" /> : initials(active?.name ?? '?')}
          </span>
          <span className="su-thread-id">
            <span className="su-thread-name">{active?.name}</span>
            {active?.specialty && <span className="su-thread-specialty">{active.specialty}</span>}
          </span>
        </div>

        {contextCard}

        <div
          className="su-chat"
          ref={scrollerRef}
          onScroll={e => { if (!ctxEditing) setCtxMini((e.target as HTMLDivElement).scrollTop > 24); }}
        >
          {messages.length === 0 && (
            <div className="su-chat-intro">
              <p>Say hi to {active?.name} and tell them what you&apos;re looking for.</p>
              <p className="su-chat-intro-sub">e.g. &ldquo;I need a date-night fit&rdquo; or &ldquo;help me build a capsule for work&rdquo;.</p>
            </div>
          )}
          {messages.map(m => {
            if (m.kind === 'product' && m.productRef?.swap) {
              const sw = m.productRef.swap;
              return (
                <div key={m.id} className="su-msg su-msg--stylist">
                  <div className="su-swap">
                    <div className="su-swap-label">Pick a {sw.label}</div>
                    <div className="su-swap-options">
                      {sw.options.map((o, i) => (
                        <button
                          key={o.id || i}
                          type="button"
                          className="su-swap-opt"
                          onClick={() => void selectSwapOption(sw.role, o)}
                          disabled={genLook}
                        >
                          <span className="su-swap-opt-media">
                            {o.image ? <img src={o.image} alt={o.name || ''} loading="lazy" /> : <span className="su-product-media--empty" />}
                          </span>
                          <span className="su-swap-opt-info">
                            {o.brand && <span className="su-swap-opt-brand">{o.brand}</span>}
                            <span className="su-swap-opt-name">{o.name || 'Option'}</span>
                            {o.price && <span className="su-swap-opt-price">{o.price}</span>}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            }
            if (m.kind === 'product' && m.productRef) {
              const p = m.productRef;
              const key = p.id || p.url || p.name || '';
              return (
                <div key={m.id} className="su-msg su-msg--stylist">
                  <div className="su-product">
                    <div className="su-product-media">
                      {p.image ? <img src={p.image} alt={p.name || 'Product'} loading="lazy" /> : <span className="su-product-media--empty" />}
                    </div>
                    <div className="su-product-info">
                      {p.brand && <div className="su-product-brand">{p.brand}</div>}
                      <div className="su-product-name">{p.name || 'Product'}</div>
                      {p.price && <div className="su-product-price">{p.price}</div>}
                      <div className="su-product-actions">
                        {p.url && (
                          <button type="button" className="su-product-btn" onClick={() => window.open(p.url!, '_blank', 'noopener')}>Shop</button>
                        )}
                        <button
                          type="button"
                          className="su-product-btn su-product-btn--primary"
                          onClick={() => void tryOn(p)}
                          disabled={renderingIds.has(key)}
                        >
                          {renderingIds.has(key) ? 'Starting…' : 'See it on me'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }
            if (m.kind === 'render') {
              const r = m.renderGenerationId ? renders[m.renderGenerationId] : null;
              const p = m.productRef;
              const pieces = p?.pieces ?? [];
              const done = r?.status === 'done' && r.video_url;
              const failed = r?.status === 'failed';
              return (
                <div key={m.id} className="su-msg su-msg--stylist">
                  <div className="su-render">
                    {done ? (
                      <video className="su-render-video" src={r!.video_url!} autoPlay loop muted playsInline controls />
                    ) : failed ? (
                      <div className="su-render-status su-render-status--failed">Couldn&apos;t render that look — try another piece.</div>
                    ) : (
                      <div className="su-render-cook">
                        <div className="su-render-status">
                          <span className="su-render-spinner" aria-hidden="true" />
                          <span className="su-render-status-text">
                            Putting your look together…
                            <span className="su-render-eta">
                              {fmtRemaining(generationProgress(r?.created_at ?? m.createdAt, r?.duration_seconds ?? 10).remainingSec)}
                            </span>
                          </span>
                        </div>
                        {/* The pieces going into the look (mirrors the studio's
                            cooking screen) — float them while it renders. */}
                        {pieces.length > 0 && (
                          <div className="su-render-pieces">
                            {pieces.slice(0, 6).map((pc, i) => (
                              <span className="su-render-piece" key={pc.id || i} style={{ animationDelay: `${i * 0.18}s` }} title={[pc.brand, pc.name].filter(Boolean).join(' · ')}>
                                {pc.image ? <img src={pc.image} alt="" loading="lazy" /> : <span className="su-product-media--empty" />}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {done && pieces.length > 0 && (
                      <div className="su-render-pieces su-render-pieces--done">
                        {pieces.slice(0, 6).map((pc, i) => (
                          <span className="su-render-piece" key={pc.id || i} title={[pc.brand, pc.name].filter(Boolean).join(' · ')}>
                            {pc.image ? <img src={pc.image} alt="" loading="lazy" /> : <span className="su-product-media--empty" />}
                          </span>
                        ))}
                      </div>
                    )}
                    {done && (
                      <div className="su-render-cap">
                        <span>{p ? [p.brand, p.name].filter(Boolean).join(' · ') || 'Your look' : 'Your look'}</span>
                        <button
                          type="button"
                          className="su-product-btn su-product-btn--primary"
                          onClick={() => void addToLooks(m.renderGenerationId as string, pieces)}
                          disabled={published.has(m.renderGenerationId as string)}
                        >
                          {published.has(m.renderGenerationId as string) ? 'Added ✓' : 'Add to my looks'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            }
            return (
              <div key={m.id} className={`su-msg su-msg--${m.sender}`}>
                {m.body && <div className="su-bubble">{m.body}</div>}
              </div>
            );
          })}
          {stylistTyping && (
            <div className="su-msg su-msg--stylist">
              <div className="su-bubble su-bubble--typing" aria-label={`${active?.name ?? 'Stylist'} is typing`}>
                <span /><span /><span />
              </div>
            </div>
          )}
          {chatError && !stylistTyping && (
            <button type="button" className="su-chat-retry" onClick={() => void triggerStylist()}>
              {chatError} <span className="su-chat-retry-go">Retry</span>
            </button>
          )}
          {renderError && <div className="su-render-err">{renderError}</div>}
        </div>

        <div className="su-composer">
          <input
            className="su-composer-input"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void send(); } }}
            placeholder={`Message ${active?.name ?? 'your stylist'}…`}
          />
          <button type="button" className="su-composer-send" onClick={() => void send()} disabled={!draft.trim() || sending} aria-label="Send">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
