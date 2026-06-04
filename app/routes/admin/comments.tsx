import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from '@remix-run/react';
import { useSortableTable, SortableTh } from '~/components/SortableTable';
import { useAdminConfirm } from '~/components/AdminConfirm';
import {
  listAllComments,
  subscribeAllComments,
  setCommentHidden,
  deleteComment,
  type CommentRow,
} from '~/services/comments';

/**
 * /admin/comments — every comment posted across the platform. Admins can
 * hide (soft-remove from the consumer thread) or delete outright. Live
 * via the comments realtime channel. Read-side filtering uses the shared
 * admin ?q search so the topbar filters this view like every other table.
 */

interface DisplayRow {
  id: string;
  author: string;
  authorAvatar: string | null;
  target: string;
  type: string;
  slug: string;
  body: string;
  created: string;
  createdLabel: string;
  hidden: boolean;
}

function toDisplay(c: CommentRow): DisplayRow {
  return {
    id: c.id,
    author: c.author?.full_name || (c.author?.is_ai ? 'AI persona' : 'Unknown'),
    authorAvatar: c.author?.avatar_url ?? null,
    target: c.target_label || c.target_id,
    type: c.target_type,
    slug: c.target_id,
    body: c.body,
    created: c.created_at,
    createdLabel: new Date(c.created_at).toLocaleString(),
    hidden: c.hidden,
  };
}

export default function AdminComments() {
  const [rows, setRows] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm } = useAdminConfirm();
  const [searchParams] = useSearchParams();
  const q = (searchParams.get('q') || '').toLowerCase().trim();

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      listAllComments().then(data => {
        if (!cancelled) { setRows(data); setLoading(false); }
      });
    };
    refresh();
    const unsub = subscribeAllComments(refresh);
    return () => { cancelled = true; unsub(); };
  }, []);

  const display = useMemo(() => rows.map(toDisplay), [rows]);
  const filtered = useMemo(() => {
    if (!q) return display;
    return display.filter(r =>
      r.author.toLowerCase().includes(q)
      || r.target.toLowerCase().includes(q)
      || r.body.toLowerCase().includes(q)
      || r.type.toLowerCase().includes(q),
    );
  }, [display, q]);

  const table = useSortableTable(filtered, { key: 'created', direction: 'desc' });

  const hiddenCount = display.filter(r => r.hidden).length;

  const handleToggleHidden = async (row: DisplayRow) => {
    setBusyId(row.id);
    setError(null);
    const { error: err } = await setCommentHidden(row.id, !row.hidden);
    setBusyId(null);
    if (err) { setError(err); return; }
    // Optimistic — realtime will reconcile.
    setRows(prev => prev.map(r => (r.id === row.id ? { ...r, hidden: !row.hidden } : r)));
  };

  const handleDelete = async (row: DisplayRow) => {
    const ok = await confirm({
      title: 'Delete comment?',
      message: `"${row.body.slice(0, 120)}"${row.body.length > 120 ? '…' : ''}`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setBusyId(row.id);
    setError(null);
    const { error: err } = await deleteComment(row.id);
    setBusyId(null);
    if (err) { setError(err); return; }
    setRows(prev => prev.filter(r => r.id !== row.id));
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Comments</h1>
        <p className="admin-page-subtitle">
          Every comment shoppers leave on products and looks across the
          platform. Hide one to pull it from the public thread, or delete
          it outright. {hiddenCount > 0 && <strong>{hiddenCount} hidden.</strong>}
        </p>
      </div>

      {error && (
        <div style={{ margin: '0 0 12px', padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 13, color: '#991b1b' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="admin-empty">Loading…</div>
      ) : table.sortedData.length === 0 ? (
        <div className="admin-empty">{q ? `No comments match “${q}”.` : 'No comments yet.'}</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <SortableTh label="Author" sortKey="author" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="Comment" sortKey="body" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="On" sortKey="target" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="Type" sortKey="type" currentSort={table.sort} onSort={table.handleSort} />
                <SortableTh label="Posted" sortKey="created" currentSort={table.sort} onSort={table.handleSort} />
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {table.sortedData.map(row => (
                <tr key={row.id} style={{ opacity: row.hidden ? 0.5 : 1 }}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {row.authorAvatar
                        ? <img src={row.authorAvatar} alt="" style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover' }} />
                        : <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#e5e7eb', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#6b7280' }}>{row.author.charAt(0).toUpperCase()}</span>}
                      <span>{row.author}</span>
                    </div>
                  </td>
                  <td style={{ maxWidth: 360 }}>
                    <span style={{ display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{row.body}</span>
                    {row.hidden && <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#b45309' }}>Hidden</span>}
                  </td>
                  <td>
                    <a
                      href={`/comments/${row.type === 'product' ? 'p' : 'l'}/${row.slug}`}
                      style={{ color: '#2563eb', textDecoration: 'none' }}
                    >
                      {row.target}
                    </a>
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{row.type}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{row.createdLabel}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      className="admin-btn admin-btn-secondary"
                      disabled={busyId === row.id}
                      onClick={() => handleToggleHidden(row)}
                      style={{ marginRight: 6 }}
                    >
                      {row.hidden ? 'Unhide' : 'Hide'}
                    </button>
                    <button
                      className="admin-btn"
                      disabled={busyId === row.id}
                      onClick={() => handleDelete(row)}
                      style={{ color: '#dc2626', borderColor: '#fecaca' }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
