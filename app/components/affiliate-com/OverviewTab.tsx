// Overview / dashboard tab — account profile, connection health, and a
// few headline KPIs pulled from the summary + merchants endpoints.

import { affiliateCom } from '~/services/affiliate-com';
import { ConnectionPill, ErrorBanner, Spinner, Kpi, useAffiliateCall } from './shared';

function num(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return v.toLocaleString();
  const n = Number(v);
  return isNaN(n) ? String(v) : n.toLocaleString();
}

export default function OverviewTab() {
  const account = useAffiliateCall(() => affiliateCom.account(), []);
  const summary = useAffiliateCall(() => affiliateCom.reportSummary(), []);
  const merchants = useAffiliateCall(() => affiliateCom.listMerchants({ per_page: 1 }), []);

  const acct = (account.result?.data ?? {}) as Record<string, unknown>;
  const sum = (summary.result?.data ?? {}) as Record<string, unknown>;
  const merchTotal = merchants.result?.list?.total ?? null;

  const loading = account.loading || summary.loading || merchants.loading;
  // Surface the first real error (not configured > others).
  const error = [account, summary, merchants]
    .map(s => s.result && !s.result.success ? s.result.error : null)
    .find(Boolean) ?? null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Account overview</h2>
        <ConnectionPill />
      </div>

      <ErrorBanner error={error} />

      <div className="admin-stats-grid" style={{ marginBottom: 20 }}>
        <Kpi label="Balance" value={
          acct.balance != null ? `${acct.currency ? `${acct.currency} ` : '$'}${num(acct.balance)}` : '—'
        } />
        <Kpi label="Pending commission" value={
          sum.pending_commission != null ? num(sum.pending_commission)
            : sum.commission != null ? num(sum.commission) : '—'
        } sub="this period" />
        <Kpi label="Clicks" value={num(sum.clicks ?? sum.total_clicks)} sub="this period" />
        <Kpi label="Conversions" value={num(sum.conversions ?? sum.sales ?? sum.transactions)} sub="this period" />
        <Kpi label="Merchant programs" value={merchTotal != null ? merchTotal.toLocaleString() : '—'} />
        <Kpi label="EPC" value={sum.epc != null ? num(sum.epc) : '—'} sub="earnings/click" />
      </div>

      {loading && <Spinner label="Loading account…" />}

      {account.result?.success && (
        <section style={{ marginTop: 8 }}>
          <h3 style={{ fontSize: 13, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 8px' }}>Profile</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, fontSize: 13 }}>
            {([['Name', acct.name], ['Email', acct.email], ['Account ID', acct.id], ['Status', acct.status]] as [string, unknown][]).map(([k, v]) => (
              <div key={k}>
                <div style={{ color: '#94a3b8', fontSize: 11 }}>{k}</div>
                <div style={{ fontWeight: 600 }}>{v != null && v !== '' ? String(v) : '—'}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
