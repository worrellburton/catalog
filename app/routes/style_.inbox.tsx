// /style/inbox — human stylist's inbox (Phase 2.3).
//
// Lists every thread assigned to the signed-in human stylist, ordered by
// last message. Selecting one shows the message log + a text composer that
// posts sender='stylist' rows via the same style_up_messages table the AI
// stylist uses; RLS added in the 20260824130000 migration lets a human
// stylist read/write into their own threads. Product pick-and-attach is
// deferred to a follow-up — text replies unlock the human-in-the-loop
// flow shoppers already have.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { useAuth } from '~/hooks/useAuth';
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
  created_at: string;
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

  // Load messages when a thread is opened. Subscribe to new inserts so the
  // stylist sees shopper replies live.
  useEffect(() => {
    if (!openId) { setMessages([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('style_up_messages')
        .select('id, sender, kind, body, created_at')
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
      .select('id, sender, kind, body, created_at')
      .single();
    if (error) { setError(error.message); setSending(false); return; }
    await supabase.from('style_up_threads')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', openId);
    setMessages(prev => prev.some(x => x.id === (data as MessageRow).id) ? prev : [...prev, data as MessageRow]);
    setReply('');
    setSending(false);
  }, [openId, stylist, reply, sending]);

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
        <p>You&apos;re not a stylist yet. Apply first — this is where shopper threads land once you&apos;re approved.</p>
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
                {m.kind !== 'text' && <span className="su-inbox-msg-body su-inbox-msg-nontext">[{m.kind}]</span>}
              </div>
            ))}
          </div>
          {error && <div className="su-apply-error">{error}</div>}
          <div className="su-inbox-composer">
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
        </>
      )}
    </div>
  );
}
