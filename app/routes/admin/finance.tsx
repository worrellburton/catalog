import { useEffect, useMemo, useState } from 'react';
import { supabase } from '~/utils/supabase';
import { VIDEO_MODEL_PRICING, PRICING_BY_SLUG, estimateAdCost } from '~/constants/video-model-pricing';

type Tab = 'overview' | 'gen-ai' | 'transactions' | 'payouts' | 'invoices';

const stats = [
  { label: 'Gross Revenue (MTD)', value: '$0.00' },
  { label: 'Net Revenue (MTD)', value: '$0.00' },
  { label: 'Pending Payouts', value: '$0.00' },
  { label: 'Platform Fees (MTD)', value: '$0.00' },
  { label: 'Refunds (MTD)', value: '$0.00' },
  { label: 'Creator Earnings (MTD)', value: '$0.00' },
];

interface AdSpendRow {
  id: string;
  veo_model: string | null;
  cost_usd: number | null;
  status: string;
  created_at: string;
}

export default function AdminFinance() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [adRows, setAdRows] = useState<AdSpendRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('product_ads')
        .select('id, veo_model, cost_usd, status, created_at')
        .order('created_at', { ascending: false });
      if (!cancelled) {
        if (!error && data) setAdRows(data as AdSpendRow[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const spendStats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let total = 0;
    let month = 0;
    let completedTotal = 0;
    let completedMonth = 0;
    let completedCount = 0;
    const byModel = new Map<string, { count: number; spend: number; status: Record<string, number> }>();
    for (const ad of adRows) {
      const model = ad.veo_model || 'unknown';
      const est = ad.cost_usd != null ? ad.cost_usd : estimateAdCost(ad.veo_model);
      total += est;
      const created = new Date(ad.created_at);
      const isMonth = created >= monthStart;
      if (isMonth) month += est;
      if (ad.status === 'done' || ad.status === 'live' || ad.status === 'paused') {
        completedCount += 1;
        completedTotal += est;
        if (isMonth) completedMonth += est;
      }
      const entry = byModel.get(model) ?? { count: 0, spend: 0, status: {} };
      entry.count += 1;
      entry.spend += est;
      entry.status[ad.status] = (entry.status[ad.status] || 0) + 1;
      byModel.set(model, entry);
    }
    return { total, month, completedTotal, completedMonth, completedCount, byModel };
  }, [adRows]);

  const sortedByModel = useMemo(() => {
    return Array.from(spendStats.byModel.entries())
      .map(([slug, data]) => ({ slug, ...data, label: PRICING_BY_SLUG[slug]?.label ?? slug }))
      .sort((a, b) => b.spend - a.spend);
  }, [spendStats]);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Finance</h1>
        <p className="admin-page-subtitle">Revenue, payouts, invoices, and platform financials</p>
      </div>

      <div className="admin-stats-grid" style={{ marginBottom: 20 }}>
        {stats.map(s => (
          <div key={s.label} className="admin-stat-card">
            <span className="admin-stat-value">{s.value}</span>
            <span className="admin-stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>Overview</button>
        <button className={`admin-tab ${activeTab === 'gen-ai' ? 'active' : ''}`} onClick={() => setActiveTab('gen-ai')}>Gen AI</button>
        <button className={`admin-tab ${activeTab === 'transactions' ? 'active' : ''}`} onClick={() => setActiveTab('transactions')}>Transactions</button>
        <button className={`admin-tab ${activeTab === 'payouts' ? 'active' : ''}`} onClick={() => setActiveTab('payouts')}>Payouts</button>
        <button className={`admin-tab ${activeTab === 'invoices' ? 'active' : ''}`} onClick={() => setActiveTab('invoices')}>Invoices</button>
      </div>

      {activeTab === 'gen-ai' ? (
        <GenAiPanel
          loading={loading}
          adRows={adRows}
          spend={spendStats}
          sortedByModel={sortedByModel}
        />
      ) : (
        <div className="admin-empty">
          {activeTab === 'overview' && 'No financial activity yet'}
          {activeTab === 'transactions' && 'No transactions yet'}
          {activeTab === 'payouts' && 'No payouts yet'}
          {activeTab === 'invoices' && 'No invoices yet'}
        </div>
      )}
    </div>
  );
}

function fmt(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `<$0.01`;
  return `$${usd.toFixed(2)}`;
}

function GenAiPanel({
  loading,
  adRows,
  spend,
  sortedByModel,
}: {
  loading: boolean;
  adRows: AdSpendRow[];
  spend: { total: number; month: number; completedTotal: number; completedMonth: number; completedCount: number };
  sortedByModel: { slug: string; label: string; count: number; spend: number; status: Record<string, number> }[];
}) {
  if (loading) return <div className="admin-empty">Loading spend…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="admin-stats-grid">
        <div className="admin-stat-card">
          <span className="admin-stat-value">{fmt(spend.month)}</span>
          <span className="admin-stat-label">Gen AI spend (MTD)</span>
        </div>
        <div className="admin-stat-card">
          <span className="admin-stat-value">{fmt(spend.total)}</span>
          <span className="admin-stat-label">Gen AI spend (all-time)</span>
        </div>
        <div className="admin-stat-card">
          <span className="admin-stat-value">{adRows.length}</span>
          <span className="admin-stat-label">Total ads</span>
        </div>
        <div className="admin-stat-card">
          <span className="admin-stat-value">{spend.completedCount}</span>
          <span className="admin-stat-label">Completed</span>
        </div>
      </div>

      <div>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600 }}>Spend by model</h3>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Model</th>
                <th style={{ textAlign: 'right' }}>Ads</th>
                <th style={{ textAlign: 'right' }}>Est. spend</th>
                <th style={{ textAlign: 'right' }}>Rate / clip</th>
                <th style={{ textAlign: 'left' }}>Status mix</th>
              </tr>
            </thead>
            <tbody>
              {sortedByModel.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: '#94a3b8', padding: 20 }}>No ads generated yet</td></tr>
              ) : sortedByModel.map(row => {
                const rate = PRICING_BY_SLUG[row.slug]?.costUsd;
                return (
                  <tr key={row.slug}>
                    <td style={{ textAlign: 'left', fontWeight: 600 }}>{row.label}</td>
                    <td style={{ textAlign: 'right' }}>{row.count}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(row.spend)}</td>
                    <td style={{ textAlign: 'right', color: '#64748b' }}>{rate ? `$${rate.toFixed(2)}` : '—'}</td>
                    <td style={{ textAlign: 'left', fontSize: 11, color: '#64748b' }}>
                      {Object.entries(row.status).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}:${n}`).join(' · ')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600 }}>Rate sheet</h3>
        <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 10px' }}>
          Ballpark list price for a single ~5s 720p portrait clip. Actual billed cost depends on resolution, duration, and provider billing tiers.
        </p>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Model</th>
                <th style={{ textAlign: 'left' }}>Provider</th>
                <th style={{ textAlign: 'right' }}>$ / clip</th>
                <th style={{ textAlign: 'left' }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {VIDEO_MODEL_PRICING.map(m => (
                <tr key={m.value}>
                  <td style={{ textAlign: 'left', fontWeight: 600 }}>{m.label}</td>
                  <td style={{ textAlign: 'left', fontSize: 12, color: '#64748b' }}>{m.group}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>${m.costUsd.toFixed(2)}</td>
                  <td style={{ textAlign: 'left', fontSize: 11, color: '#64748b' }}>
                    {m.multiImage ? 'Multi-image reference · ' : ''}{m.notes || ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
