// Admin · StyleUp — monitoring dashboard. Two stacked sections:
//   1) Active conversations — every shopper↔stylist thread with ≥1 message.
//   2) Looks generated — StyleUp "on-you" renders (video + shopper + pieces).
// Full controls: open a transcript, reply as the stylist, delete a thread or a
// look. Admin-gated by the /admin shell; admins have full RLS access.

import { useCallback, useEffect, useState } from 'react';
import {
  adminListThreads, adminListLooks, adminSendStylistMessage, adminDeleteThread, adminDeleteLook,
  fetchMessages,
  type AdminThread, type AdminLook, type StyleUpMessage,
} from '~/services/style-up';
import '~/styles/admin-style-up.css';

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function statusClass(s: string): string {
  if (s === 'done') return 'sua-pill sua-pill--done';
  if (s === 'failed') return 'sua-pill sua-pill--failed';
  return 'sua-pill sua-pill--pending';
}

export default function AdminStyleUpPage() {
  const [threads, setThreads] = useState<AdminThread[]>([]);
  const [looks, setLooks] = useState<AdminLook[]>([]);
  const [loading, setLoading] = useState(true);

  // Transcript drawer.
  const [openThread, setOpenThread] = useState<AdminThread | null>(null);
  const [transcript, setTranscript] = useState<StyleUpMessage[]>([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [t, l] = await Promise.all([adminListThreads(), adminListLooks()]);
    setThreads(t);
    setLooks(l);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const openTranscript = useCallback(async (t: AdminThread) => {
    setOpenThread(t);
    setTranscript([]);
    setReply('');
    setTranscript(await fetchMessages(t.threadId));
  }, []);

  const sendReply = useCallback(async () => {
    if (!openThread || !reply.trim() || sending) return;
    setSending(true);
    const ok = await adminSendStylistMessage(openThread.threadId, reply.trim());
    if (ok) {
      setReply('');
      setTranscript(await fetchMessages(openThread.threadId));
      void load();
    }
    setSending(false);
  }, [openThread, reply, sending, load]);

  const removeThread = useCallback(async (t: AdminThread) => {
    if (!window.confirm(`Delete the conversation between ${t.shopper.name} and ${t.stylist.name}? This removes all its messages.`)) return;
    await adminDeleteThread(t.threadId);
    if (openThread?.threadId === t.threadId) setOpenThread(null);
    void load();
  }, [openThread, load]);

  const removeLook = useCallback(async (l: AdminLook) => {
    if (!window.confirm('Remove this generated look from the conversation?')) return;
    await adminDeleteLook(l.messageId);
    void load();
  }, [load]);

  return (
    <div className="sua">
      <div className="sua-head">
        <div>
          <h1 className="sua-title">StyleUp</h1>
          <p className="sua-sub">Live AI-stylist conversations and the looks they&apos;ve generated.</p>
        </div>
        <button type="button" className="sua-refresh" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* ── Active conversations ─────────────────────────────────────────── */}
      <section className="sua-section">
        <div className="sua-section-head">
          <h2>Active conversations</h2>
          <span className="sua-count">{threads.length}</span>
        </div>
        {threads.length === 0 && !loading && <div className="sua-empty">No conversations yet.</div>}
        <div className="sua-rows">
          {threads.map(t => (
            <div key={t.threadId} className="sua-row">
              <span className="sua-avatar" aria-hidden="true">
                {t.shopper.avatarUrl ? <img src={t.shopper.avatarUrl} alt="" /> : (t.shopper.name[0] || '?')}
              </span>
              <div className="sua-row-main" onClick={() => void openTranscript(t)} role="button" tabIndex={0}
                   onKeyDown={e => { if (e.key === 'Enter') void openTranscript(t); }}>
                <div className="sua-row-top">
                  <span className="sua-row-name">{t.shopper.name}</span>
                  <span className="sua-row-with">with <b style={{ color: t.stylist.accentColor ?? '#8aa0c0' }}>{t.stylist.name}</b></span>
                  {t.awaitingStylist && <span className="sua-badge">Awaiting reply</span>}
                </div>
                <div className="sua-row-preview">{t.lastMessage || '—'}</div>
              </div>
              <div className="sua-row-meta">
                <span className="sua-row-count">{t.messageCount} msg{t.messageCount === 1 ? '' : 's'}</span>
                <span className="sua-row-time">{fmtTime(t.lastMessageAt)}</span>
              </div>
              <div className="sua-row-actions">
                <button type="button" className="sua-btn" onClick={() => void openTranscript(t)}>Open</button>
                <button type="button" className="sua-btn sua-btn--danger" onClick={() => void removeThread(t)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Looks generated ──────────────────────────────────────────────── */}
      <section className="sua-section">
        <div className="sua-section-head">
          <h2>Looks generated</h2>
          <span className="sua-count">{looks.length}</span>
        </div>
        {looks.length === 0 && !loading && <div className="sua-empty">No looks generated yet.</div>}
        <div className="sua-looks">
          {looks.map(l => (
            <div key={l.messageId} className="sua-look">
              <div className="sua-look-media">
                {l.status === 'done' && l.videoUrl
                  ? <video src={l.videoUrl} muted loop playsInline controls />
                  : <div className={`sua-look-status sua-look-status--${l.status}`}>{l.status === 'failed' ? 'Failed' : 'Rendering…'}</div>}
              </div>
              <div className="sua-look-body">
                <div className="sua-look-top">
                  <span className="sua-avatar sua-avatar--sm" aria-hidden="true">
                    {l.shopper.avatarUrl ? <img src={l.shopper.avatarUrl} alt="" /> : (l.shopper.name[0] || '?')}
                  </span>
                  <span className="sua-look-who">
                    <b>{l.shopper.name}</b>
                    {l.stylist && <span className="sua-look-stylist" style={{ color: l.stylist.accentColor ?? '#8aa0c0' }}> · {l.stylist.name}</span>}
                  </span>
                  <span className={statusClass(l.status)}>{l.status}</span>
                </div>
                {l.products.length > 0 && (
                  <div className="sua-look-products">
                    {l.products.slice(0, 6).map((p, i) => (
                      <span className="sua-look-prod" key={i} title={[p.brand, p.name].filter(Boolean).join(' · ')}>
                        {p.image ? <img src={p.image} alt="" /> : <span className="sua-look-prod--empty" />}
                      </span>
                    ))}
                  </div>
                )}
                <div className="sua-look-foot">
                  <span className="sua-row-time">{fmtTime(l.createdAt)}</span>
                  <button type="button" className="sua-btn sua-btn--danger" onClick={() => void removeLook(l)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Transcript drawer ────────────────────────────────────────────── */}
      {openThread && (
        <div className="sua-drawer-backdrop" onClick={() => setOpenThread(null)}>
          <div className="sua-drawer" onClick={e => e.stopPropagation()}>
            <div className="sua-drawer-head">
              <span className="sua-avatar" aria-hidden="true">
                {openThread.shopper.avatarUrl ? <img src={openThread.shopper.avatarUrl} alt="" /> : (openThread.shopper.name[0] || '?')}
              </span>
              <div className="sua-drawer-id">
                <span className="sua-row-name">{openThread.shopper.name}</span>
                <span className="sua-row-with">with <b style={{ color: openThread.stylist.accentColor ?? '#8aa0c0' }}>{openThread.stylist.name}</b></span>
              </div>
              <button type="button" className="sua-drawer-close" onClick={() => setOpenThread(null)} aria-label="Close">✕</button>
            </div>
            <div className="sua-transcript">
              {transcript.map(m => {
                if (m.kind === 'render') {
                  return (
                    <div key={m.id} className="sua-msg sua-msg--stylist">
                      <div className="sua-msg-render">On-you look {m.renderGenerationId ? `(${m.renderGenerationId.slice(0, 8)})` : ''}</div>
                    </div>
                  );
                }
                if (m.kind === 'product' && m.productRef) {
                  return (
                    <div key={m.id} className="sua-msg sua-msg--stylist">
                      <div className="sua-msg-product">
                        {m.productRef.image && <img src={m.productRef.image} alt="" />}
                        <span>{[m.productRef.brand, m.productRef.name].filter(Boolean).join(' · ') || 'Product'}</span>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={m.id} className={`sua-msg sua-msg--${m.sender}`}>
                    <div className="sua-bubble">{m.body}</div>
                  </div>
                );
              })}
              {transcript.length === 0 && <div className="sua-empty">No messages.</div>}
            </div>
            <div className="sua-reply">
              <input
                className="sua-reply-input"
                value={reply}
                onChange={e => setReply(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void sendReply(); } }}
                placeholder={`Reply as ${openThread.stylist.name}…`}
              />
              <button type="button" className="sua-btn sua-btn--primary" onClick={() => void sendReply()} disabled={!reply.trim() || sending}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
