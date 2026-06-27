// Style Up — AI stylist chat (admin-gated v1). A shopper requests a stylist
// from the roster, then chats iMessage-style; the stylist (AI, wired in a
// later phase) sends product picks + on-you renders. The shopper's AI-look
// context rides at the top, read-only, so the stylist always sees who it's
// styling.
//
// Phase 1 (this file): roster → open/resume a thread → context card + live
// message list + composer (shopper text persists + streams via realtime).
// The AI stylist replies, product picks, and renders land in later phases.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '~/hooks/useAuth';
import { supabase } from '~/utils/supabase';
import {
  fetchStylists, getOrCreateThread, fetchMessages, sendShopperMessage, startLookRender,
  type StyleUpStylist, type StyleUpMessage,
} from '~/services/style-up';
import { getUserHeightAge, getUserCustomStyle } from '~/services/profiles';
import { getUserGender, type UserGender } from '~/services/genders';
import { listUserUploads, getUserSlots, getGeneration, type UserGeneration } from '~/services/user-generations';
import '~/styles/style-up.css';

const MAX_PHOTOS = 3;

interface ShopperContext {
  photos: string[];
  chips: string[];
  style: string | null;
}

function initials(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

export default function StyleUpPage() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [stylists, setStylists] = useState<StyleUpStylist[]>([]);
  const [active, setActive] = useState<StyleUpStylist | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StyleUpMessage[]>([]);
  const [opening, setOpening] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [stylistTyping, setStylistTyping] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [ctx, setCtx] = useState<ShopperContext | null>(null);
  // Render polling: generation id → its latest row. Drives the on-you render
  // bubbles (spinner → video).
  const [renders, setRenders] = useState<Record<string, UserGeneration>>({});
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderingIds, setRenderingIds] = useState<Set<string>>(new Set());
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Roster.
  useEffect(() => { void fetchStylists().then(setStylists); }, []);

  // Shopper context — the SAME inputs the AI-look flow uses (face photos +
  // height / weight / age / gender + saved style). Read-only here; editing it
  // in the AI studio updates the profile the stylist reads each turn.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const [ha, gender, style, uploads, slots] = await Promise.all([
        getUserHeightAge(userId),
        getUserGender(userId),
        getUserCustomStyle(userId),
        listUserUploads(userId),
        getUserSlots(userId, MAX_PHOTOS),
      ]);
      if (cancelled) return;
      const byId = new Map(uploads.map(u => [u.id, u.public_url]));
      const picked = slots.map(id => (id ? byId.get(id) : null)).filter((u): u is string => !!u);
      const photos = picked.length ? picked : uploads.slice(0, MAX_PHOTOS).map(u => u.public_url).filter(Boolean);
      const chips: string[] = [];
      if (ha.heightLabel) chips.push(ha.heightLabel);
      if (ha.weightLabel) chips.push(ha.weightLabel.replace(/\s*\(.*\)\s*/, ''));
      if (ha.ageLabel) chips.push(ha.ageLabel);
      if (gender !== 'unknown') chips.push(gender as UserGender);
      setCtx({ photos, chips, style: style || null });
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Open (or resume) a thread with the chosen stylist.
  const openStylist = useCallback(async (s: StyleUpStylist) => {
    if (!userId || opening) return;
    setOpening(true);
    setActive(s);
    const id = await getOrCreateThread(s.id, userId);
    if (id) {
      setThreadId(id);
      setMessages(await fetchMessages(id));
    }
    setOpening(false);
  }, [userId, opening]);

  const closeThread = useCallback(() => {
    setThreadId(null);
    setActive(null);
    setMessages([]);
    setDraft('');
  }, []);

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
  // the call resolves. Any failure (incl. the function not being deployed yet)
  // surfaces a recoverable error row with a retry, rather than silently
  // dropping the turn.
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

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !threadId || sending) return;
    setSending(true);
    setDraft('');
    const msg = await sendShopperMessage(threadId, text);
    if (msg) setMessages(prev => (prev.some(m => m.id === msg.id) ? prev : [...prev, msg]));
    setSending(false);
    void triggerStylist();
  }, [draft, threadId, sending, triggerStylist]);

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

  const contextCard = useMemo(() => (
    <div className="su-context" aria-label="Your styling context">
      <div className="su-context-photos">
        {ctx && ctx.photos.length > 0
          ? ctx.photos.map((src, i) => (
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
        <div className="su-context-note">Your stylist sees this. Edit it in the AI studio and it updates here.</div>
      </div>
    </div>
  ), [ctx]);

  // ── Roster ────────────────────────────────────────────────────────────
  if (!threadId) {
    return (
      <div className="su-page">
        <div className="su-roster-head">
          <h1>Style Up</h1>
          <p>Request a stylist. They&apos;ll learn your vibe, send picks, and show you wearing them.</p>
        </div>
        <div className="su-roster">
          {stylists.map(s => (
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
        </div>
      </div>
    );
  }

  // ── Thread ────────────────────────────────────────────────────────────
  return (
    <div className="su-page su-page--thread" style={{ ['--su-accent' as string]: active?.accentColor ?? '#8aa0c0' }}>
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

      <div className="su-chat" ref={scrollerRef}>
        {messages.length === 0 && (
          <div className="su-chat-intro">
            <p>Say hi to {active?.name} and tell them what you&apos;re looking for.</p>
            <p className="su-chat-intro-sub">e.g. &ldquo;I need a date-night fit&rdquo; or &ldquo;help me build a capsule for work&rdquo;.</p>
          </div>
        )}
        {messages.map(m => {
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
                    <div className="su-render-status">
                      <span className="su-render-spinner" aria-hidden="true" />
                      Styling you in {p?.name ? p.name : 'this look'}…
                    </div>
                  )}
                  {done && p && (
                    <div className="su-render-cap">
                      <span>{[p.brand, p.name].filter(Boolean).join(' · ')}</span>
                      {p.url && <button type="button" className="su-product-btn" onClick={() => window.open(p.url!, '_blank', 'noopener')}>Shop</button>}
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
  );
}
