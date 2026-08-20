// Admin · Style — the observatory over everything happening in StyleUp.
// Two tabs (?tab=):
//   chat        — index of every shopper↔stylist conversation, live. Each row
//                 opens its own page (style.$threadId.tsx) — transcript +
//                 research trace, READ-ONLY (no replying/deleting).
//   generations — every on-you render in a sortable table; clicking a row
//                 navigates to its own audit page (style.g.$generationId.tsx)
//                 showing exactly how the generation happened (step log +
//                 inputs → pieces → prompt → model → output).
// Both tabs poll while open so the floor updates live.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from '@remix-run/react';
import {
  adminListThreads, adminListLooks,
  type AdminThread, type AdminLook,
} from '~/services/style-up';
import { fmtTime, statusClass } from '~/components/style-up/admin-format';
import { useSortableTable, SortableTh } from '~/components/SortableTable';
import '~/styles/admin-style-up.css';

export default function AdminStylePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'generations' ? 'generations' : 'chat';
  const setTab = useCallback((t: string) => {
    setSearchParams(t === 'chat' ? {} : { tab: t }, { replace: true });
  }, [setSearchParams]);

  const [threads, setThreads] = useState<AdminThread[]>([]);
  const [looks, setLooks] = useState<AdminLook[]>([]);
  const [loading, setLoading] = useState(true);

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
                <Link className="sua-row-main" to={`/admin/style/${t.threadId}`}>
                  <div className="sua-row-top">
                    <span className="sua-row-name">{t.shopper.name}</span>
                    <span className="sua-row-with">with <b style={{ color: t.stylist.accentColor ?? '#8aa0c0' }}>{t.stylist.name}</b></span>
                    {t.awaitingStylist && <span className="sua-badge">Awaiting reply</span>}
                  </div>
                  <div className="sua-row-preview">{t.lastMessage || '—'}</div>
                </Link>
                <div className="sua-row-meta">
                  <span className="sua-row-count">{t.messageCount} msg{t.messageCount === 1 ? '' : 's'}</span>
                  <span className="sua-row-time">{fmtTime(t.lastMessageAt)}</span>
                </div>
                <div className="sua-row-actions">
                  <Link className="sua-btn" to={`/admin/style/${t.threadId}`}>Open</Link>
                  <Link className="sua-btn" to={`/admin/style/${t.threadId}?view=research`}>Research</Link>
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
                  <tr key={r.messageId} className="sua-table-row"
                      onClick={() => { if (r.look.generationId) navigate(`/admin/style/g/${r.look.generationId}`); }}>
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
    </div>
  );
}
