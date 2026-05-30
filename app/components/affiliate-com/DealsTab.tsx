// Deals & Coupons tab — active offers across merchants. Codes are
// click-to-copy; each deal can deep-link out. Falls back to the generic
// adaptive table if the upstream shape isn't the one we expect.

import { useState } from 'react';
import { affiliateCom, type AffiliateDeal } from '~/services/affiliate-com';
import {
  useAffiliateCall, ErrorBanner, Spinner, EmptyState, Pagination, GenericTable, JsonDrawer,
} from './shared';

export default function DealsTab() {
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState<AffiliateDeal | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const perPage = 50;

  const { loading, result } = useAffiliateCall(() => affiliateCom.listDeals({ page, per_page: perPage }), [page]);
  const rows = (result?.list?.items ?? []) as AffiliateDeal[];
  const total = result?.list?.total ?? null;
  const recognized = rows.length > 0 && rows.some(d => d.title || d.code || d.discount);

  const copy = (code: string) => {
    try { navigator.clipboard?.writeText(code); setCopied(code); setTimeout(() => setCopied(null), 1500); } catch { /* ignore */ }
  };

  return (
    <div>
      <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>Deals &amp; coupons</h2>

      <ErrorBanner error={result && !result.success ? result.error : null} />
      {loading && <Spinner label="Loading deals…" />}

      {result?.success && rows.length === 0 && !loading && <EmptyState label="No active deals right now." />}

      {result?.success && recognized && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {rows.map((d, i) => (
              <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, background: '#fff', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{d.merchant ?? ''}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{d.title ?? d.description ?? 'Offer'}</div>
                {d.discount && <div style={{ fontSize: 13, color: '#16a34a', fontWeight: 700 }}>{String(d.discount)}</div>}
                {(d.starts_at || d.ends_at) && (
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    {d.starts_at ? `From ${String(d.starts_at).slice(0, 10)}` : ''}{d.ends_at ? ` · Ends ${String(d.ends_at).slice(0, 10)}` : ''}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, marginTop: 'auto', paddingTop: 6 }}>
                  {d.code && (
                    <button type="button" className="admin-btn admin-btn-secondary" style={{ fontSize: 11, fontFamily: 'monospace' }} onClick={() => copy(String(d.code))}>
                      {copied === d.code ? 'Copied!' : `${d.code} ⧉`}
                    </button>
                  )}
                  {d.url && (
                    <a href={String(d.url)} target="_blank" rel="noopener noreferrer" className="admin-btn admin-btn-secondary" style={{ fontSize: 11, textDecoration: 'none' }}>Open ↗</a>
                  )}
                  <button type="button" className="admin-btn admin-btn-secondary" style={{ fontSize: 11, marginLeft: 'auto' }} onClick={() => setDrawer(d)}>Details</button>
                </div>
              </div>
            ))}
          </div>
          <Pagination page={page} perPage={perPage} total={total} onPage={setPage} />
        </>
      )}

      {result?.success && rows.length > 0 && !recognized && <GenericTable rows={rows} onRowClick={(r) => setDrawer(r as AffiliateDeal)} />}

      {drawer && <JsonDrawer title={drawer.title ?? 'Deal'} value={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}
