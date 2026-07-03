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
import { getGeneration, type UserGeneration } from '~/services/user-generations';
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

// ── Generation node overlay — everything about one render, as a pipeline. ──
function GenerationDiagram({ look, gen }: { look: AdminLook; gen: UserGeneration | null }) {
  return (
    <div className="sug-flow">
      <div className="sug-node">
        <div className="sug-node-title">Shopper inputs</div>
        <div className="sug-node-body">
          <div className="sug-kv"><span>Shopper</span><b>{look.shopper.name}</b></div>
          <div className="sug-kv"><span>Height</span><b>{gen?.height_label ?? '—'}</b></div>
          <div className="sug-kv"><span>Weight</span><b>{gen?.weight_label ?? '—'}</b></div>
          <div className="sug-kv"><span>Age</span><b>{gen?.age_label ?? '—'}</b></div>
          <div className="sug-kv"><span>Style</span><b>{gen?.style ?? '—'}</b></div>
        </div>
      </div>
      <div className="sug-arrow" aria-hidden="true">→</div>
      <div className="sug-node">
        <div className="sug-node-title">Pieces ({look.products.length})</div>
        <div className="sug-node-body sug-node-body--pieces">
          {look.products.length === 0 && <span className="sug-dim">none recorded</span>}
          {look.products.map((p, i) => (
            <span className="sug-piece" key={p.id || i} title={[p.brand, p.name].filter(Boolean).join(' · ')}>
              {p.image ? <img src={p.image} alt="" /> : <span className="sug-piece--empty" />}
            </span>
          ))}
        </div>
      </div>
      <div className="sug-arrow" aria-hidden="true">→</div>
      <div className="sug-node sug-node--wide">
        <div className="sug-node-title">Prompt</div>
        <pre className="sug-prompt">{gen?.prompt || '—'}</pre>
      </div>
      <div className="sug-arrow" aria-hidden="true">→</div>
      <div className="sug-node">
        <div className="sug-node-title">Model</div>
        <div className="sug-node-body">
          <div className="sug-kv"><span>Tier</span><b>{gen?.model ?? '—'}</b></div>
          <div className="sug-kv"><span>Engine</span><b>{gen?.veo_model ?? '—'}</b></div>
          <div className="sug-kv"><span>Duration</span><b>{gen ? `${gen.duration_seconds}s` : '—'}</b></div>
          <div className="sug-kv"><span>Started</span><b>{fmtTime(gen?.created_at ?? look.createdAt)}</b></div>
          <div className="sug-kv"><span>Took</span><b>{fmtElapsed(gen?.created_at ?? null, gen?.completed_at ?? null)}</b></div>
          {gen?.fal_request_id && <div className="sug-kv"><span>Request</span><b className="sug-mono">{gen.fal_request_id.slice(0, 14)}…</b></div>}
        </div>
      </div>
      <div className="sug-arrow" aria-hidden="true">→</div>
      <div className="sug-node sug-node--out">
        <div className="sug-node-title">
          Output <span className={statusClass(gen?.status ?? look.status)}>{gen?.status ?? look.status}</span>
        </div>
        {gen?.status === 'failed' && gen.error
          ? <pre className="sug-prompt sug-prompt--err">{gen.error}</pre>
          : (gen?.video_url ?? look.videoUrl)
            ? <video className="sug-video" src={(gen?.video_url ?? look.videoUrl)!} muted loop playsInline controls />
            : <div className="sug-dim">Still rendering…</div>}
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

  // Open the node overlay with the FULL generation row ("everything").
  const openGeneration = useCallback(async (l: AdminLook) => {
    setOpenLook(l);
    setOpenGen(null);
    if (l.generationId) setOpenGen(await getGeneration(l.generationId));
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

      {/* ── Generation node overlay ──────────────────────────────────────── */}
      {openLook && (
        <div className="sua-drawer-backdrop" onClick={() => { setOpenLook(null); setOpenGen(null); }}>
          <div className="sua-drawer sua-drawer--wide" onClick={e => e.stopPropagation()}>
            <div className="sua-drawer-head">
              <div className="sua-drawer-id">
                <span className="sua-row-name">Generation</span>
                <span className="sua-row-with">
                  {openLook.shopper.name}
                  {openLook.stylist && <> with <b style={{ color: openLook.stylist.accentColor ?? '#8aa0c0' }}>{openLook.stylist.name}</b></>}
                  {' · '}{fmtTime(openLook.createdAt)}
                </span>
              </div>
              <button type="button" className="sua-drawer-close" onClick={() => { setOpenLook(null); setOpenGen(null); }} aria-label="Close">✕</button>
            </div>
            <div className="sua-trace-body">
              {openLook.generationId && !openGen && <div className="sua-empty">Loading generation…</div>}
              {(openGen || !openLook.generationId) && <GenerationDiagram look={openLook} gen={openGen} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
