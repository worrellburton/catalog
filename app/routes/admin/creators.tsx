import { useEffect, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { useSortableTable, SortableTh } from '~/components/SortableTable';
import { listAdminCreators, type AdminCreatorRow } from '~/services/creators';
import ShopMyImportWizard from '~/components/ShopMyImportWizard';

export default function AdminCreators() {
  const [activeTab, setActiveTab] = useState<'creators' | 'incoming'>('creators');
  const [rows, setRows] = useState<AdminCreatorRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const { sortedData, sort, handleSort } = useSortableTable(rows);
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    listAdminCreators()
      .then(({ rows, error }) => {
        setRows(rows);
        setError(error);
      })
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Creators</h1>
        <p className="admin-page-subtitle">Manage platform creators</p>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${activeTab === 'creators' ? 'active' : ''}`} onClick={() => setActiveTab('creators')}>
          Creators
          {rows.length > 0 && <span className="admin-tab-badge">{rows.length}</span>}
        </button>
        <button className={`admin-tab ${activeTab === 'incoming' ? 'active' : ''}`} onClick={() => setActiveTab('incoming')}>
          Incoming
          <span className="admin-tab-badge">0</span>
        </button>
      </div>

      {activeTab === 'creators' ? (
        <>
          {importing ? (
            <ShopMyImportWizard
              onClose={() => setImporting(false)}
              onDone={() => { setImporting(false); load(); }}
            />
          ) : (
            <button className="admin-btn admin-btn-primary" onClick={() => setImporting(true)}>
              Import from ShopMy
            </button>
          )}
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <SortableTh label="Creator" sortKey="display_name" currentSort={sort} onSort={handleSort} />
                  <SortableTh label="Handle" sortKey="handle" currentSort={sort} onSort={handleSort} />
                  <SortableTh label="Source" sortKey="source" currentSort={sort} onSort={handleSort} />
                  <SortableTh label="Products" sortKey="products" currentSort={sort} onSort={handleSort} />
                  <SortableTh label="Looks" sortKey="looks" currentSort={sort} onSort={handleSort} />
                  <SortableTh label="Joined" sortKey="created_at" currentSort={sort} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {sortedData.map((c) => (
                  <tr key={c.handle} onClick={() => navigate(`/admin/creators/${encodeURIComponent(c.handle)}`)} style={{ cursor: 'pointer' }}>
                    <td>
                      {c.avatar_url
                        ? <img src={c.avatar_url} alt="" width={28} height={28} loading="lazy" style={{ borderRadius: '50%', verticalAlign: 'middle', marginRight: 8 }} />
                        : null}
                      {c.display_name}
                    </td>
                    <td>{c.handle}</td>
                    <td>{c.source ?? '—'}</td>
                    <td>{c.products}</td>
                    <td>{c.looks}</td>
                    <td>{c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {loading && <p className="admin-form-hint">Loading creators…</p>}
          {!loading && error && <div className="admin-form-error">Failed to load creators: {error}</div>}
          {!loading && !error && rows.length === 0 && <p className="admin-form-hint">No creators yet.</p>}
        </>
      ) : (
        <p className="admin-form-hint">No incoming creator applications.</p>
      )}
    </div>
  );
}
