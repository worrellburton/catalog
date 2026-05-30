// Overview / dashboard tab — affiliate.com team account (plan, rate
// limits, usage) plus headline counts pulled from the merchants and
// networks endpoints. The connection pill is the live health check.

import { affiliateCom } from '~/services/affiliate-com';
import { ConnectionPill, ErrorBanner, Spinner, Kpi, useAffiliateCall } from './shared';

function num(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return v.toLocaleString();
  const n = Number(v);
  return isNaN(n) ? String(v) : n.toLocaleString();
}

// Account responses nest team/plan/usage differently across tiers; probe
// a few likely shapes so the KPIs populate without assuming one schema.
function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] != null) return obj[k];
    // one level deep (e.g. account.rate_limit.per_minute)
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && (v as Record<string, unknown>)[k] != null) {
        return (v as Record<string, unknown>)[k];
      }
    }
  }
  return undefined;
}

export default function OverviewTab() {
  const account = useAffiliateCall(() => affiliateCom.account(), []);
  const merchants = useAffiliateCall(() => affiliateCom.listMerchants({ per_page: 1 }), []);
  const networks = useAffiliateCall(() => affiliateCom.networks({ per_page: 1 }), []);

  const acct = (account.result?.data ?? {}) as Record<string, unknown>;
  const merchTotal = merchants.result?.list?.total ?? null;
  const netTotal = networks.result?.list?.total ?? null;

  const loading = account.loading || merchants.loading || networks.loading;
  const error = [account, merchants, networks]
    .map(s => s.result && !s.result.success ? s.result.error : null)
    .find(Boolean) ?? null;

  const teamName = pick(acct, 'name', 'team_name', 'team');
  const plan = pick(acct, 'plan', 'tier', 'subscription');
  const rateLimit = pick(acct, 'per_minute', 'rate_limit', 'requests_per_minute');
  const usage = pick(acct, 'usage', 'requests_used', 'used');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Account overview</h2>
        <ConnectionPill />
      </div>

      <ErrorBanner error={error} />

      <div className="admin-stats-grid" style={{ marginBottom: 20 }}>
        <Kpi label="Merchant programs" value={merchTotal != null ? merchTotal.toLocaleString() : '—'} />
        <Kpi label="Networks" value={netTotal != null ? netTotal.toLocaleString() : '—'} />
        <Kpi label="Plan" value={plan != null ? String(plan) : '—'} />
        <Kpi label="Rate limit" value={rateLimit != null ? `${num(rateLimit)}/min` : '—'} />
        <Kpi label="Usage" value={usage != null ? num(usage) : '—'} sub="requests" />
        <Kpi label="Team" value={teamName != null ? String(teamName) : '—'} />
      </div>

      {loading && <Spinner label="Loading account…" />}

      {account.result?.success && (
        <section style={{ marginTop: 8 }}>
          <h3 style={{ fontSize: 13, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 8px' }}>Account (raw)</h3>
          <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: 14, borderRadius: 8, fontSize: 12, overflow: 'auto', maxHeight: 360 }}>
            {JSON.stringify(acct, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}
