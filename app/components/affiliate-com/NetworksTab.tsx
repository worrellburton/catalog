// Networks tab — the affiliate networks (and network groups) aggregated
// by affiliate.com. Searchable + paginated, with a raw-JSON detail drawer.

import { useState } from 'react';
import { affiliateCom, type AffiliateNetwork } from '~/services/affiliate-com';
import {
  useAffiliateCall, ErrorBanner, Spinner, EmptyState, Pagination, SearchBar, JsonDrawer, GenericTable,
} from './shared';

export default function NetworksTab() {
  const [q, setQ] = useState('');
  const [submittedQ, setSubmittedQ] = useState('');
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState<AffiliateNetwork | null>(null);
  const [showGroups, setShowGroups] = useState(false);
  const perPage = 50;

  const networks = useAffiliateCall(
    () => affiliateCom.networks({ page, per_page: perPage, search: submittedQ || undefined }),
    [page, submittedQ, showGroups],
    { auto: !showGroups },
  );
  const groups = useAffiliateCall(
    () => affiliateCom.networkGroups({ per_page: 200 }),
    [showGroups],
    { auto: showGroups },
  );

  const active = showGroups ? groups : networks;
  const rows = (active.result?.list?.items ?? []) as AffiliateNetwork[];
  const total = active.result?.list?.total ?? null;

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button type="button" onClick={() => setShowGroups(false)}
          className={`admin-btn ${!showGroups ? 'admin-btn-primary' : 'admin-btn-secondary'}`} style={{ fontSize: 12 }}>
          Networks
        </button>
        <button type="button" onClick={() => setShowGroups(true)}
          className={`admin-btn ${showGroups ? 'admin-btn-primary' : 'admin-btn-secondary'}`} style={{ fontSize: 12 }}>
          Network Groups
        </button>
      </div>

      {!showGroups && (
        <SearchBar value={q} onChange={setQ}
          onSubmit={() => { setPage(1); setSubmittedQ(q); }}
          placeholder="Search networks by name…" />
      )}

      <ErrorBanner error={active.result && !active.result.success ? active.result.error : null} />
      {active.loading && <Spinner label={showGroups ? 'Loading network groups…' : 'Loading networks…'} />}

      {active.result?.success && rows.length === 0 && !active.loading && <EmptyState label="No rows returned." />}

      {active.result?.success && rows.length > 0 && (
        <>
          <GenericTable
            rows={rows}
            columns={showGroups ? undefined : ['id', 'name', 'status', 'merchant_count']}
            onRowClick={(r) => setDrawer(r as AffiliateNetwork)}
          />
          {!showGroups && <Pagination page={page} perPage={perPage} total={total} onPage={setPage} />}
        </>
      )}

      {drawer && <JsonDrawer title={String(drawer.name ?? drawer.id ?? 'Network')} value={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}
