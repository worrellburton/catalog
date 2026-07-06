// Admin · Style — the observatory over everything happening in StyleUp.
// Two tabs (?tab=):
//   chat        — every shopper↔stylist conversation, live, READ-ONLY
//                 (transcript + research-trace drawers; no replying/deleting).
//   generations — every on-you render in a sortable table; clicking a row
//                 opens a node overlay showing exactly how the generation
//                 happened (inputs → pieces → prompt → model → output).
// Both tabs poll while open so the floor updates live.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from '@remix-run/react';
import {
  adminListThreads, adminListLooks, fetchMessages, adminListTraces,
  type AdminThread, type AdminLook, type StyleUpMessage, type StyleUpTrace,
} from '~/services/style-up';
import { getGenerationDetail, type UserGeneration, type UserUpload } from '~/services/user-generations';
import { roleTagFromName } from '~/services/product-roles';
import StyleUpTraceDiagram from '~/components/style-up/StyleUpTraceDiagram';
import { useSortableTable, SortableTh } from '~/components/SortableTable';
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

/** Seconds between two timestamps, pretty-printed ("74s" / "2m 3s"). */
function fmtElapsed(fromIso: string | null, toIso: string | null): string {
  if (!fromIso || !toIso) return '—';
  const s = Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000);
  if (!Number.isFinite(s) || s < 0) return '—';
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ── Generation graph — everything about one render, in the same light
// Input → Model → Output node style as the Data page's Polish graph. ──
const gCard = { border: '1px solid #cbd5e1', borderRadius: 12, padding: 12, background: '#fff', display: 'flex', flexDirection: 'column' as const, gap: 8 };
const gLabel = { fontSize: 10, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.08em', fontWeight: 700 };
const gKv = { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, color: '#64748b' };
const gKvVal = { fontWeight: 600, color: '#0f172a', textAlign: 'right' as const };
const gArrow = { fontSize: 28, color: '#cbd5e1', textAlign: 'center' as const, lineHeight: 1 };

// Head-to-toe display order for the pieces row (hat → jacket → top →
// bottoms → shoes, accessories last). New generations are stored in this
// order already; the name-based sort covers renders from before that.
const SLOT_ORDER: Record<string, number> = { Hat: 0, Sunglasses: 1, Jacket: 2, Top: 3, Dress: 3, Pants: 4, Shoes: 5, Jewelry: 6, Bag: 7, Accessory: 8 };
function sortHeadToToe<T extends { name?: string }>(pieces: T[]): T[] {
  return [...pieces].sort((a, b) =>
    (SLOT_ORDER[roleTagFromName(a.name ?? null) ?? ''] ?? 9) - (SLOT_ORDER[roleTagFromName(b.name ?? null) ?? ''] ?? 9));
}

function GenerationDiagram({ look, gen, uploads }: { look: AdminLook; gen: UserGeneration | null; uploads: UserUpload[] }) {
  const status = gen?.status ?? look.status;
  const videoUrl = gen?.video_url ?? look.videoUrl;
  const pieces = sortHeadToToe(look.products);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1.2fr auto 1fr', gap: 12, alignItems: 'start' }}>
      {/* Input — the shopper + the pieces going into the render. */}
      <div style={gCard}>
        <div style={gLabel}>Input · Shopper + pieces</div>
        <div style={gKv}><span>Shopper</span><span style={gKvVal}>{look.shopper.name}</span></div>
        <div style={gKv}><span>Height</span><span style={gKvVal}>{gen?.height_label ?? '—'}</span></div>
        <div style={gKv}><span>Weight</span><span style={gKvVal}>{gen?.weight_label ?? '—'}</span></div>
        <div style={gKv}><span>Age</span><span style={gKvVal}>{gen?.age_label ?? '—'}</span></div>
        <div style={gKv}><span>Style</span><span style={gKvVal}>{gen?.style ?? '—'}</span></div>
        <div style={{ ...gLabel, marginTop: 4 }}>Shopper photos ({uploads.length})</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {uploads.length === 0 && <span style={{ fontSize: 12, color: '#94a3b8' }}>(none recorded)</span>}
          {uploads.map(u => (
            <span key={u.id} title="Photo of the shopper sent to the model"
              style={{ width: 40, height: 50, borderRadius: 6, overflow: 'hidden', background: '#f1f5f9', border: '1px solid #e2e8f0' }}>
              <img src={u.public_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </span>
          ))}
        </div>
        <div style={{ ...gLabel, marginTop: 4 }}>Pieces ({pieces.length})</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {pieces.length === 0 && <span style={{ fontSize: 12, color: '#94a3b8' }}>(none recorded)</span>}
          {pieces.map((p, i) => (
            <span key={p.id || i} title={[p.brand, p.name].filter(Boolean).join(' · ')}
              style={{ width: 40, height: 50, borderRadius: 6, overflow: 'hidden', background: '#f1f5f9', border: '1px solid #e2e8f0' }}>
              {p.image && <img src={p.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
            </span>
          ))}
        </div>
      </div>
      <div style={gArrow}>→</div>
      {/* Model — engine, the literal prompt, and run metadata. */}
      <div style={{ ...gCard, border: '1px solid #ddd6fe', background: '#faf5ff' }}>
        <div style={{ ...gLabel, color: '#7c3aed' }}>Model · Look generation (photos + pieces → video)</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {gen?.veo_model ?? 'veo'}{gen?.model ? ` (${gen.model})` : ''}
        </div>
        <div
          title="The literal prompt sent for this generation."
          style={{
            fontSize: 11, color: '#475569', lineHeight: 1.45, padding: 8,
            background: '#fff', borderRadius: 6, border: '1px solid #ede9fe',
            whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto',
          }}
        >
          {gen?.prompt || '(prompt unavailable)'}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11, color: '#64748b' }}>
          <span>duration: {gen ? `${gen.duration_seconds}s` : '—'}</span>
          <span>started: {fmtTime(gen?.created_at ?? look.createdAt)}</span>
          <span>took: {fmtElapsed(gen?.created_at ?? null, gen?.completed_at ?? null)}</span>
          {gen?.fal_request_id && <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>req: {gen.fal_request_id.slice(0, 12)}…</span>}
        </div>
      </div>
      <div style={gArrow}>→</div>
      {/* Output — the finished look, or why it failed. */}
      <div style={gCard}>
        <div style={gLabel}>Output · {status === 'done' ? 'Generated look' : status === 'failed' ? 'Failed' : 'Rendering…'}</div>
        {status === 'failed' && gen?.error ? (
          <div style={{ fontSize: 11, color: '#b91c1c', lineHeight: 1.45, padding: 8, background: '#fef2f2', borderRadius: 6, border: '1px solid #fecaca', whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto' }}>
            {gen.error}
          </div>
        ) : videoUrl ? (
          <video src={videoUrl} muted loop playsInline controls style={{ width: '100%', aspectRatio: '9 / 16', objectFit: 'contain', background: '#f1f5f9', borderRadius: 8 }} />
        ) : (
          <div style={{ fontSize: 12, color: '#94a3b8' }}>(no video yet)</div>
        )}
      </div>
    </div>
  );
}

export default function AdminStylePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'generations' ? 'generations' : 'chat';
  const setTab = useCallback((t: string) => {
    setSearchParams(t === 'chat' ? {} : { tab: t }, { replace: true });
  }, [setSearchParams]);

  const [threads, setThreads] = useState<AdminThread[]>([]);
  const [looks, setLooks] = useState<AdminLook[]>([]);
  const [loading, setLoading] = useState(true);

  // Read-only transcript drawer.
  const [openThread, setOpenThread] = useState<AdminThread | null>(null);
  const [transcript, setTranscript] = useState<StyleUpMessage[]>([]);

  // Research-trace drawer.
  const [traceThread, setTraceThread] = useState<AdminThread | null>(null);
  const [traces, setTraces] = useState<StyleUpTrace[]>([]);
  const [traceIdx, setTraceIdx] = useState(0);
  const [traceLoading, setTraceLoading] = useState(false);

  // Generation node overlay.
  const [openLook, setOpenLook] = useState<AdminLook | null>(null);
  const [openGen, setOpenGen] = useState<UserGeneration | null>(null);
  const [openUploads, setOpenUploads] = useState<UserUpload[]>([]);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    const [t, l] = await Promise.all([adminListThreads(), adminListLooks()]);
    setThreads(t);
    setLooks(l);
    setLoading(false);
  }, []);
  useEffect(() => { void load(true); }, [load]);

  // Live floor: refresh the lists while the page is open.
  useEffect(() => {
    const h = window.setInterval(() => { void load(); }, 5000);
    return () => window.clearInterval(h);
  }, [load]);

  // Live transcript while a conversation drawer is open.
  useEffect(() => {
    if (!openThread) return;
    let cancelled = false;
    const tick = async () => {
      const msgs = await fetchMessages(openThread.threadId);
      if (!cancelled) setTranscript(msgs);
    };
    void tick();
    const h = window.setInterval(tick, 4000);
    return () => { cancelled = true; window.clearInterval(h); };
  }, [openThread]);

  const openTraces = useCallback(async (t: AdminThread) => {
    setTraceThread(t);
    setTraces([]);
    setTraceIdx(0);
    setTraceLoading(true);
    setTraces(await adminListTraces(t.threadId));
    setTraceLoading(false);
  }, []);

  // Open the node overlay with the FULL generation row ("everything"),
  // including the shopper photos that were sent to the model.
  const openGeneration = useCallback(async (l: AdminLook) => {
    setOpenLook(l);
    setOpenGen(null);
    setOpenUploads([]);
    if (l.generationId) {
      const detail = await getGenerationDetail(l.generationId);
      setOpenGen(detail.generation);
      setOpenUploads(detail.uploads);
    }
  }, []);

  // Flat rows so every generation column is sortable.
  const genRows = useMemo(() => looks.map(l => ({
    messageId: l.messageId,
    createdAt: l.createdAt,
    shopper: l.shopper.name,
    stylist: l.stylist?.name ?? '—',
    pieces: l.products.length,
    status: l.status,
    look: l,
  })), [looks]);
  const { sortedData, sort, handleSort } = useSortableTable(genRows, { key: 'createdAt', direction: 'desc' });

  return (
    <div className="sua">
      <div className="sua-head">
        <div>
          <h1 className="sua-title">Style</h1>
          <p className="sua-sub">Everything happening in StyleUp — live conversations and every look generated.</p>
        </div>
        <div className="sua-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'chat'} className={`sua-tab${tab === 'chat' ? ' is-active' : ''}`} onClick={() => setTab('chat')}>
            Chat <span className="sua-count">{threads.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'generations'} className={`sua-tab${tab === 'generations' ? ' is-active' : ''}`} onClick={() => setTab('generations')}>
            Generations <span className="sua-count">{looks.length}</span>
          </button>
        </div>
      </div>

      {/* ── Chat — read-only observatory over every conversation ─────────── */}
      {tab === 'chat' && (
        <section className="sua-section">
          {threads.length === 0 && !loading && <div className="sua-empty">No conversations yet.</div>}
          <div className="sua-rows">
            {threads.map(t => (
              <div key={t.threadId} className="sua-row">
                <span className="sua-avatar" aria-hidden="true">
                  {t.shopper.avatarUrl ? <img src={t.shopper.avatarUrl} alt="" /> : (t.shopper.name[0] || '?')}
                </span>
                <div className="sua-row-main" onClick={() => setOpenThread(t)} role="button" tabIndex={0}
                     onKeyDown={e => { if (e.key === 'Enter') setOpenThread(t); }}>
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
                  <button type="button" className="sua-btn" onClick={() => setOpenThread(t)}>Open</button>
                  <button type="button" className="sua-btn" onClick={() => void openTraces(t)}>Research</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Generations — every render, sortable, node overlay on click ──── */}
      {tab === 'generations' && (
        <section className="sua-section">
          {looks.length === 0 && !loading && <div className="sua-empty">No generations yet.</div>}
          {looks.length > 0 && (
            <table className="sua-table">
              <thead>
                <tr>
                  <SortableTh label="When" sortKey="createdAt" currentSort={sort} onSort={handleSort} />
                  <SortableTh label="Shopper" sortKey="shopper" currentSort={sort} onSort={handleSort} />
                  <SortableTh label="Stylist" sortKey="stylist" currentSort={sort} onSort={handleSort} />
                  <SortableTh label="Pieces" sortKey="pieces" currentSort={sort} onSort={handleSort} />
                  <SortableTh label="Status" sortKey="status" currentSort={sort} onSort={handleSort} />
                  <th>Look</th>
                </tr>
              </thead>
              <tbody>
                {sortedData.map(r => (
                  <tr key={r.messageId} className="sua-table-row" onClick={() => void openGeneration(r.look)}>
                    <td>{fmtTime(r.createdAt)}</td>
                    <td>{r.shopper}</td>
                    <td style={{ color: r.look.stylist?.accentColor ?? undefined }}>{r.stylist}</td>
                    <td>
                      <span className="sua-table-pieces">
                        {r.look.products.slice(0, 4).map((p, i) => (
                          p.image ? <img key={p.id || i} src={p.image} alt="" /> : null
                        ))}
                        {r.pieces === 0 ? '—' : ` ${r.pieces}`}
                      </span>
                    </td>
                    <td><span className={statusClass(r.status)}>{r.status}</span></td>
                    <td>{r.look.videoUrl ? <video className="sua-table-video" src={r.look.videoUrl} muted playsInline /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* ── Read-only transcript drawer ──────────────────────────────────── */}
      {openThread && (
        <div className="sua-drawer-backdrop" onClick={() => setOpenThread(null)}>
          <div className="sua-drawer" onClick={e => e.stopPropagation()}>
            <div className="sua-drawer-head">
              <span className="sua-avatar" aria-hidden="true">
                {openThread.shopper.avatarUrl ? <img src={openThread.shopper.avatarUrl} alt="" /> : (openThread.shopper.name[0] || '?')}
              </span>
              <div className="sua-drawer-id">
                <span className="sua-row-name">{openThread.shopper.name}</span>
                <span className="sua-row-with">with <b style={{ color: openThread.stylist.accentColor ?? '#8aa0c0' }}>{openThread.stylist.name}</b> · live</span>
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
          </div>
        </div>
      )}

      {/* ── Research-trace drawer ─────────────────────────────────────────── */}
      {traceThread && (
        <div className="sua-drawer-backdrop" onClick={() => setTraceThread(null)}>
          <div className="sua-drawer sua-drawer--wide" onClick={e => e.stopPropagation()}>
            <div className="sua-drawer-head">
              <div className="sua-drawer-id">
                <span className="sua-row-name">Research</span>
                <span className="sua-row-with">{traceThread.shopper.name} with <b style={{ color: traceThread.stylist.accentColor ?? '#8aa0c0' }}>{traceThread.stylist.name}</b></span>
              </div>
              <button type="button" className="sua-drawer-close" onClick={() => setTraceThread(null)} aria-label="Close">✕</button>
            </div>
            {traces.length > 1 && (
              <div className="sua-trace-turns">
                {traces.map((tr, i) => (
                  <button key={tr.id} type="button" className={`sua-trace-turn${i === traceIdx ? ' is-active' : ''}`} onClick={() => setTraceIdx(i)}>
                    {fmtTime(tr.createdAt)}{tr.sourceMode === 'web' ? ' · web' : ''}
                  </button>
                ))}
              </div>
            )}
            <div className="sua-trace-body">
              {traceLoading && <div className="sua-empty">Loading…</div>}
              {!traceLoading && traces.length === 0 && (
                <div className="sua-empty">No research traces for this conversation yet. Traces are recorded on new stylist turns.</div>
              )}
              {!traceLoading && traces[traceIdx] && <StyleUpTraceDiagram trace={traces[traceIdx]} />}
            </div>
          </div>
        </div>
      )}

      {/* ── Generation graph modal (matches the Data page's Polish graph) ── */}
      {openLook && (
        <div className="admin-modal-overlay" onClick={() => { setOpenLook(null); setOpenGen(null); }}>
          <div className="admin-modal" style={{ width: 1020, maxWidth: '94vw', padding: 28 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
                Generation graph — <span style={{ color: '#7c3aed' }}>
                  {openLook.shopper.name}
                  {openLook.stylist ? ` with ${openLook.stylist.name}` : ''}
                </span>
                <span style={{ color: '#94a3b8', fontWeight: 500 }}> · {fmtTime(openLook.createdAt)}</span>
              </h2>
              <button type="button" className="admin-btn admin-btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }}
                onClick={() => { setOpenLook(null); setOpenGen(null); }}>
                Close
              </button>
            </div>
            {openLook.generationId && !openGen
              ? <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading generation…</div>
              : <GenerationDiagram look={openLook} gen={openGen} uploads={openUploads} />}
          </div>
        </div>
      )}
    </div>
  );
}
