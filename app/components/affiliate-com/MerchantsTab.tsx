// Merchants tab — browse affiliate.com advertiser programs with search,
// category filter, pagination, and a detail drawer (raw JSON + the key
// fields we recognize). Clicking a row opens the drawer.

import { useState } from 'react';
import {
  affiliateCom, type AffiliateMerchant,
  merchantName, merchantCommission,
} from '~/services/affiliate-com';
import {
  useAffiliateCall, ErrorBanner, Spinner, EmptyState,
  GenericTable, Pagination, SearchBar, JsonDrawer,
} from './shared';

export default function MerchantsTab() {
  const [q, setQ] = useState('');
  const [submittedQ, setSubmittedQ] = useState('');
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState<AffiliateMerchant | null>(null);
  const perPage = 50;

  const { loading, result } = useAffiliateCall(
    () => affiliateCom.listMerchants({ page, per_page: perPage, search: submittedQ || undefined }),
    [page, submittedQ],
  );

  const rows = (result?.list?.items ?? []) as AffiliateMerchant[];
  const total = result?.list?.total ?? null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Merchant programs</h2>
      </div>

      <SearchBar
        value={q} onChange={setQ}
        onSubmit={() => { setPage(1); setSubmittedQ(q); }}
        placeholder="Search merchants by name…"
      />

      <ErrorBanner error={result && !result.success ? result.error : null} />
      {loading && <Spinner label="Loading merchants…" />}

      {result?.success && rows.length > 0 && (
        <>
          {/* Friendly view for the recognized merchant shape, with a
              fallback to the generic adaptive table when keys differ. */}
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Merchant</th>
                  <th>Commission</th>
                  <th>Cookie</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m, i) => (
                  <tr key={i} style={{ cursor: 'pointer' }} onClick={() => setDrawer(m)}>
                    <td style={{ textAlign: 'left' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {m.logo
                          ? <img src={String(m.logo)} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          : <span style={{ width: 28, height: 28, borderRadius: 6, background: '#f1f5f9', display: 'inline-block' }} />}
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{merchantName(m)}</span>
                      </div>
                    </td>
                    <td style={{ fontSize: 13, fontWeight: 600 }}>{merchantCommission(m)}</td>
                    <td style={{ fontSize: 12 }}>{m.cookie_duration ? String(m.cookie_duration) : '—'}</td>
                    <td style={{ fontSize: 12 }}>{m.category ?? (m.categories?.[0]) ?? '—'}</td>
                    <td>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: '#f1f5f9', color: '#475569' }}>
                        {m.status ? String(m.status) : '—'}
                      </span>
                    </td>
                    <td style={{ fontSize: 11, color: '#3b82f6' }}>Details →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} perPage={perPage} total={total} onPage={setPage} />
        </>
      )}

      {result?.success && rows.length === 0 && !loading && (
        <EmptyState label="No merchants matched. Try a different search." />
      )}

      {/* When the upstream shape doesn't match our friendly columns at all
          but still returned data, show it raw so nothing's lost. */}
      {result?.success && rows.length === 0 && !!result.data && !Array.isArray(result.list?.items) && (
        <GenericTable rows={[result.data]} />
      )}

      {drawer && (
        <JsonDrawer title={merchantName(drawer)} value={drawer} onClose={() => setDrawer(null)} />
      )}
    </div>
  );
}
