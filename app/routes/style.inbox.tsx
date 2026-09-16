// /style/inbox — human stylist's inbox (Phase 2.3).
//
// Lists every thread assigned to the signed-in human stylist, ordered by
// last message. Selecting one shows the message log + a text composer that
// posts sender='stylist' rows via the same style_up_messages table the AI
// stylist uses; RLS added in the 20260824130000 migration lets a human
// stylist read/write into their own threads (it gates on thread membership
// only, so kind='product' rows pass the same check as text).
//
// The composer can also attach a shoppable product — a kind='product' row
// with the same product_ref shape the AI stylist writes, so the shopper's
// chat renders it identically. Picks come from the stylist's own showroom
// first; typing searches the wider catalog.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { useAuth } from '~/hooks/useAuth';
import { type StyleUpProductRef } from '~/services/style-up';
import { searchProducts } from '~/services/manage-looks';
import '~/styles/style-up.css';

interface StylistRow { id: string; name: string; }
interface ThreadRow {
  id: string;
  shopper_user_id: string;
  last_message_at: string;
  created_at: string;
  last_body: string | null;
  last_sender: 'shopper' | 'stylist' | null;
  shopper_name: string | null;
}
interface MessageRow {
  id: string;
  sender: 'shopper' | 'stylist';
  kind: string;
  body: string | null;
  product_ref: StyleUpProductRef | null;
  created_at: string;
}

/** products row → the product_ref shape the stylist writers use (image, not image_url). */
function toRef(
  id: string,
  p: { name?: string | null; brand?: string | null; image_url?: string | null; price?: string | null; url?: string | null } | null,
): StyleUpProductRef {
  return {
    id,
    name: p?.name ?? undefined,
    brand: p?.brand ?? undefined,
    image: p?.image_url ?? undefined,
    price: p?.price ?? undefined,
    url: p?.url ?? undefined,
  };
}

export default function StyleInboxRoute() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [stylist, setStylist] = useState<StylistRow | null>(null);
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showroom, setShowroom] = useState<StyleUpProductRef[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StyleUpProductRef[]>([]);
  const [searching, setSearching] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load the stylist row + assigned threads.
  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const { data: s, error: se } = await supabase
        .from('style_up_stylists')
        .select('id, name')
        .eq('human_user_id', user.id)
        .maybeSingle();
      if (cancelled) return;
      if (se) { setError(se.message); setLoading(false); return; }
      setStylist(s as StylistRow | null);
      if (!s) { setLoading(false); return; }
      const { data: t, error: te } = await supabase
        .from('style_up_threads')
        .select('id, shopper_user_id, last_message_at, created_at')
        .eq('stylist_id', (s as StylistRow).id)
        .order('last_message_at', { ascending: false })
        .limit(100);
      if (cancelled) return;
      if (te) { setError(te.message); setLoading(false); return; }
      const baseThreads = ((t ?? []) as Array<Omit<ThreadRow, 'last_body' | 'last_sender' | 'shopper_name'>>).map(r => ({
        ...r, last_body: null, last_sender: null, shopper_name: null,
      }));
      // Best-effort enrich: last message body + shopper display name. Both
      // queries can miss rows without breaking the thread list.
      const shopperIds = [...new Set(baseThreads.map(x => x.shopper_user_id))];
      const [profs, lastMsgs] = await Promise.all([
        shopperIds.length
          ? supabase.from('profiles').select('id, full_name').in('id', shopperIds)
          : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null }>, error: null }),
        Promise.all(baseThreads.map(th =>
          supabase.from('style_up_messages')
            .select('sender, body').eq('thread_id', th.id).eq('kind', 'text')
            .order('created_at', { ascending: false }).limit(1).maybeSingle()
        )),
      ]);
      if (cancelled) return;
      const profMap = new Map(((profs.data ?? []) as Array<{ id: string; full_name: string | null }>).map(p => [p.id, p.full_name]));
      const enriched: ThreadRow[] = baseThreads.map((th, i) => ({
        ...th,
        shopper_name: profMap.get(th.shopper_user_id) ?? null,
        last_body: (lastMsgs[i].data as { body?: string | null } | null)?.body ?? null,
        last_sender: ((lastMsgs[i].data as { sender?: 'shopper' | 'stylist' } | null)?.sender) ?? null,
      }));
      setThreads(enriched);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  // The stylist's own showroom — the first source offered when attaching a
  // product. Empty showroom falls through to the catalog search below.
  useEffect(() => {
    if (!stylist) { setShowroom([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('stylist_showroom_products')
        .select('product_id, sort, products(name, brand, image_url, price, url)')
        .eq('stylist_id', stylist.id)
        .order('sort', { ascending: true });
      if (cancelled) return;
      // The showroom is keyed (stylist, product, gender), so one product can
      // appear in two bins — dedupe by product id, the picker has no gender.
      const byId = new Map<string, StyleUpProductRef>();
      for (const r of ((data ?? []) as unknown as Array<{
        product_id: string;
        products: { name: string | null; brand: string | null; image_url: string | null; price: string | null; url: string | null } | null;
      }>)) {
        if (!byId.has(r.product_id)) byId.set(r.product_id, toRef(r.product_id, r.products));
      }
      setShowroom([...byId.values()]);
    })();
    return () => { cancelled = true; };
  }, [stylist]);

  // Debounced catalog search — same helper the showroom editor uses.
  useEffect(() => {
    if (!pickerOpen || query.trim().length < 2) { setResults([]); return; }
    const q = query.trim();
    setSearching(true);
    const t = setTimeout(async () => {
      const rows = await searchProducts(q);
      setResults(rows.map(r => toRef(r.id, r)));
      setSearching(false);
    }, 180);
    return () => clearTimeout(t);
  }, [query, pickerOpen]);

  // Load messages when a thread is opened. Subscribe to new inserts so the
  // stylist sees shopper replies live.
  useEffect(() => {
    if (!openId) { setMessages([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('style_up_messages')
        .select('id, sender, kind, body, product_ref, created_at')
        .eq('thread_id', openId)
        .order('created_at', { ascending: true })
        .limit(500);
      if (cancelled) return;
      setMessages((data ?? []) as MessageRow[]);
    })();
    const chan = supabase
      .channel(`inbox-thread-${openId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'style_up_messages', filter: `thread_id=eq.${openId}` },
        (payload) => {
          const m = payload.new as MessageRow;
          setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m]);
        },
      )
      .subscribe();
    return () => { cancelled = true; void supabase.removeChannel(chan); };
  }, [openId]);

  // Auto-scroll on new messages.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, openId]);

  const send = useCallback(async () => {
    if (!openId || !stylist || sending) return;
    const text = reply.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    const { data, error } = await supabase
      .from('style_up_messages')
      .insert({ thread_id: openId, sender: 'stylist', kind: 'text', body: text })
      .select('id, sender, kind, body, product_ref, created_at')
      .single();
    if (error) { setError(error.message); setSending(false); return; }
    await supabase.from('style_up_threads')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', openId);
    setMessages(prev => prev.some(x => x.id === (data as MessageRow).id) ? prev : [...prev, data as MessageRow]);
    setReply('');
    setSending(false);
  }, [openId, stylist, reply, sending]);

  // Attach a shoppable product: the exact row sendProductPick() writes
  // (kind='product' + product_ref) plus the same last_message_at bump, but
  // inserted here — same as send() does for text. Not via that helper: the
  // ~/services/style-up writers exist to silence the BOT in a human stylist's
  // thread, and they only let the stylist through by re-checking
  // supabase.auth.getUser(). In the Flutter shell the client doesn't refresh
  // its own token, so that call can fail on a long session and would silently
  // swallow the pick; a direct insert either lands or surfaces the real error.
  const sendProduct = useCallback(async (ref: StyleUpProductRef) => {
    if (!openId || sending) return;
    setSending(true);
    setError(null);
    const { data, error } = await supabase
      .from('style_up_messages')
      .insert({ thread_id: openId, sender: 'stylist', kind: 'product', product_ref: ref })
      .select('id, sender, kind, body, product_ref, created_at')
      .single();
    if (error || !data) { setError(error?.message ?? 'Could not attach that product.'); setSending(false); return; }
    await supabase.from('style_up_threads')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', openId);
    setMessages(prev => prev.some(x => x.id === (data as MessageRow).id) ? prev : [...prev, data as MessageRow]);
    setPickerOpen(false);
    setQuery('');
    setResults([]);
    setSending(false);
  }, [openId, sending]);

  const openThread = useMemo(() => threads.find(t => t.id === openId) ?? null, [threads, openId]);

  if (authLoading || loading) {
    return <div className="su-apply su-apply--loading">Loading…</div>;
  }

  if (!user) {
    return (
      <div className="su-apply">
        <h1>Inbox</h1>
        <p>Sign in to see your inbox.</p>
        <button type="button" className="su-apply-back" onClick={() => navigate('/style')}>Back</button>
      </div>
    );
  }

  if (!stylist) {
    return (
      <div className="su-apply">
        <h1>Inbox</h1>
        <p>You&apos;re not a stylist yet. Apply first. This is where shopper threads land once you&apos;re approved.</p>
        <div className="su-apply-actions">
          <button type="button" className="su-apply-back" onClick={() => navigate('/style')}>Back</button>
          <button type="button" className="su-apply-cta" onClick={() => navigate('/style/apply')}>Apply</button>
        </div>
      </div>
    );
  }

  return (
    <div className="su-inbox">
      <header className="su-showroom-head">
        <button type="button" className="su-apply-back" onClick={() => (openId ? setOpenId(null) : navigate('/style'))}>
          {openId ? '← Threads' : '← Back'}
        </button>
        <h1>{openId ? (openThread?.shopper_name || 'Shopper') : `${stylist.name}'s inbox`}</h1>
        {!openId && (
          <button type="button" className="su-apply-back" onClick={() => navigate('/style/showroom')} style={{ marginLeft: 'auto' }}>Showroom</button>
        )}
      </header>

      {!openId && (
        <div className="su-inbox-list">
          {threads.length === 0 && <div className="su-empty">No conversations yet.</div>}
          {threads.map(t => (
            <button key={t.id} type="button" className="su-inbox-thread" onClick={() => setOpenId(t.id)}>
              <span className="su-inbox-thread-name">{t.shopper_name || 'Shopper'}</span>
              {t.last_body && (
                <span className="su-inbox-thread-preview">
                  {t.last_sender === 'stylist' ? 'You: ' : ''}{t.last_body}
                </span>
              )}
              <span className="su-inbox-thread-time">{new Date(t.last_message_at).toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}

      {openId && (
        <>
          <div className="su-inbox-log" ref={scrollRef}>
            {messages.length === 0 && <div className="su-empty">No messages yet.</div>}
            {messages.map(m => (
              <div
                key={m.id}
                className={'su-inbox-msg su-inbox-msg--' + (m.sender === 'stylist' ? 'me' : 'them')}
              >
                {m.kind === 'text' && <span className="su-inbox-msg-body">{m.body}</span>}
                {m.kind === 'product' && (
                  <span className="su-inbox-msg-body" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {m.product_ref?.image && (
                      <img src={m.product_ref.image} alt="" width={36} height={36} style={{ borderRadius: 6, objectFit: 'cover' }} />
                    )}
                    {m.product_ref?.name ?? 'Product'}
                  </span>
                )}
                {m.kind !== 'text' && m.kind !== 'product' && (
                  <span className="su-inbox-msg-body su-inbox-msg-nontext">[{m.kind}]</span>
                )}
              </div>
            ))}
          </div>
          {error && <div className="su-apply-error">{error}</div>}
          <div className="su-inbox-composer">
            <button
              type="button"
              className="su-apply-back"
              disabled={sending}
              onClick={() => setPickerOpen(true)}
              aria-label="Attach a product"
            >+ Product</button>
            <textarea
              value={reply}
              onChange={e => setReply(e.target.value)}
              rows={2}
              placeholder="Reply to the shopper…"
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
              }}
            />
            <button type="button" className="su-apply-cta" disabled={sending || !reply.trim()} onClick={() => void send()}>
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>

          {pickerOpen && (
            <div className="su-showroom-search-sheet" role="dialog" aria-label="Attach a product">
              <div className="su-showroom-search-head">
                <input
                  type="text"
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={showroom.length ? 'Search the catalog…' : 'Your showroom is empty, search the catalog…'}
                />
                <button type="button" className="su-apply-back" onClick={() => { setPickerOpen(false); setQuery(''); setResults([]); }}>Cancel</button>
              </div>
              <div className="su-showroom-search-results">
                {searching && <div className="su-empty">Searching…</div>}
                {!searching && query.trim().length >= 2 && results.length === 0 && <div className="su-empty">No matches.</div>}
                {(query.trim().length >= 2 ? results : showroom).map(p => (
                  <button
                    key={p.id}
                    type="button"
                    className="su-showroom-hit"
                    disabled={sending}
                    onClick={() => void sendProduct(p)}
                  >
                    {p.image && <img src={p.image} alt="" loading="lazy" />}
                    <div>
                      <div className="su-showroom-hit-name">{p.name ?? 'Untitled'}</div>
                      {p.brand && <div className="su-showroom-hit-brand">{p.brand}{p.price ? ` · ${p.price}` : ''}</div>}
                    </div>
                    <span className="su-showroom-hit-add">Send</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
