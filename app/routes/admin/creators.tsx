import { useEffect, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { useSortableTable, SortableTh } from '~/components/SortableTable';
import { listAdminCreators, type AdminCreatorRow } from '~/services/creators';
import { listFeaturedCreatorHandles, setCreatorFeatured } from '~/services/directory';
import ShopMyImportWizard from '~/components/ShopMyImportWizard';

export default function AdminCreators() {
  const [activeTab, setActiveTab] = useState<'creators' | 'incoming'>('creators');
  const [rows, setRows] = useState<AdminCreatorRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  // Featured on the consumer /creators directory (featured_creators table).
  const [featured, setFeatured] = useState<Set<string>>(new Set());
  const [featuredBusy, setFeaturedBusy] = useState<string | null>(null);
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
  useEffect(() => {
    listFeaturedCreatorHandles().then(h => setFeatured(new Set(h.map(x => x.toLowerCase()))));
  }, []);

  const toggleFeatured = async (handle: string) => {
    const key = handle.toLowerCase();
    const on = !featured.has(key);
    setFeaturedBusy(handle);
    const { error } = await setCreatorFeatured(handle, on);
    setFeaturedBusy(null);
    if (error) { setError(`Couldn't update featured: ${error}`); return; }
    setFeatured(prev => {
      const next = new Set(prev);
      if (on) next.add(key); else next.delete(key);
      return next;
    });
  };

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
                  <th title="Shown in the Featured grid on /creators">Featured</th>
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
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className={`admin-featured-toggle${featured.has(c.handle.toLowerCase()) ? ' is-on' : ''}`}
                        onClick={() => toggleFeatured(c.handle)}
                        disabled={featuredBusy === c.handle}
                        aria-pressed={featured.has(c.handle.toLowerCase())}
                        aria-label={featured.has(c.handle.toLowerCase()) ? 'Remove from featured' : 'Feature on /creators'}
                        title={featured.has(c.handle.toLowerCase()) ? 'Featured — click to remove' : 'Feature on /creators'}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill={featured.has(c.handle.toLowerCase()) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                      </button>
                    </td>
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
