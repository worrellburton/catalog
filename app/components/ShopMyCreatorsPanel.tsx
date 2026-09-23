// Agents › Indexers › Creators: creators imported from ShopMy (source='shopmy')
// — external people with no Catalog account. Re-running a shop lives on the
// Profiles tab (Retry), which keeps a wizard-edited handle/name/bio intact.

import { useCallback, useEffect, useState } from 'react';
import { listAdminCreators, type AdminCreatorRow } from '~/services/creators';
import ShopMyImportWizard from '~/components/ShopMyImportWizard';
import { creatorSlug } from '~/utils/slug';

export default function ShopMyCreatorsPanel() {
  const [rows, setRows] = useState<AdminCreatorRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    listAdminCreators()
      .then(({ rows, error }) => {
        // ponytail: filters all creators client-side; add a source param to
        // listAdminCreators if the creators table grows past a few thousand.
        setRows(rows.filter((r) => r.source === 'shopmy'));
        setError(error);
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 8 }}>
        <p className="admin-page-subtitle" style={{ margin: 0 }}>
          Creators imported from ShopMy, with every product they’ve linked. They are not
          signed up on Catalog.
        </p>
        {!importing && (
          <button className="admin-btn admin-btn-primary" onClick={() => setImporting(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Import from ShopMy
          </button>
        )}
      </div>

      {importing && (
        <ShopMyImportWizard
          onClose={() => { setImporting(false); load(); }}
          onDone={() => { setImporting(false); load(); }}
        />
      )}

      {loading ? (
        <div className="admin-empty">Loading creators...</div>
      ) : error ? (
        <div className="admin-form-error">Failed to load creators: {error}</div>
      ) : rows.length === 0 ? (
        <div className="admin-empty">
          No ShopMy creators yet. Add a ShopMy profile on the Profiles tab, or click “Import from ShopMy”.
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Creator</th>
                <th>Handle</th>
                <th>ShopMy Shop</th>
                <th>Products</th>
                <th>Looks</th>
                <th>Imported</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.handle}>
                  <td style={{ fontWeight: 500 }}>
                    {c.avatar_url && (
                      <img src={c.avatar_url} alt="" width={28} height={28} loading="lazy"
                           style={{ borderRadius: '50%', verticalAlign: 'middle', marginRight: 8 }} />
                    )}
                    <a href={`/c/${creatorSlug(c.handle)}`} target="_blank" rel="noopener noreferrer"
                       style={{ color: 'inherit', textDecoration: 'none' }} title="Open their Catalog page">
                      {c.display_name}
                    </a>
                  </td>
                  <td className="admin-cell-muted">@{c.handle}</td>
                  <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.source_url ? (
                      <a href={c.source_url} target="_blank" rel="noopener noreferrer"
                         style={{ color: '#3b82f6', textDecoration: 'none', fontSize: 12 }}>
                        {c.source_url}
                      </a>
                    ) : ' - '}
                  </td>
                  <td>{c.products}</td>
                  <td>{c.looks}</td>
                  <td className="admin-cell-muted">
                    {c.created_at
                      ? new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      : ' - '}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
