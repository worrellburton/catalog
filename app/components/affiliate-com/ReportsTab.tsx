// Reports & analytics tab — summary KPIs + transactions / clicks /
// payments tables with a shared date-range filter. Defaults to the
// trailing 30 days.

import { useState } from 'react';
import { affiliateCom } from '~/services/affiliate-com';
import {
  useAffiliateCall, ErrorBanner, Spinner, GenericTable, Pagination, Kpi,
} from './shared';

type ReportView = 'transactions' | 'clicks' | 'payments';

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function num(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return v.toLocaleString();
  const n = Number(v);
  return isNaN(n) ? String(v) : n.toLocaleString();
}

export default function ReportsTab() {
  const [start, setStart] = useState(isoDaysAgo(30));
  const [end, setEnd] = useState(isoDaysAgo(0));
  const [applied, setApplied] = useState({ start: isoDaysAgo(30), end: isoDaysAgo(0) });
  const [view, setView] = useState<ReportView>('transactions');
  const [page, setPage] = useState(1);
  const perPage = 50;

  const summary = useAffiliateCall(() => affiliateCom.reportSummary({ start: applied.start, end: applied.end }), [applied]);
  const table = useAffiliateCall(() => {
    if (view === 'clicks') return affiliateCom.reportClicks({ start: applied.start, end: applied.end, page, per_page: perPage });
    if (view === 'payments') return affiliateCom.listPayments({ page, per_page: perPage });
    return affiliateCom.reportTransactions({ start: applied.start, end: applied.end, page, per_page: perPage });
  }, [view, page, applied]);

  const sum = (summary.result?.data ?? {}) as Record<string, unknown>;
  const rows = (table.result?.list?.items ?? []) as unknown[];
  const total = table.result?.list?.total ?? null;

  const tabs: { key: ReportView; label: string }[] = [
    { key: 'transactions', label: 'Transactions' },
    { key: 'clicks', label: 'Clicks' },
    { key: 'payments', label: 'Payments' },
  ];

  return (
    <div>
      <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>Reports &amp; analytics</h2>

      <form
        onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied({ start, end }); }}
        style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}
      >
        <label style={{ fontSize: 12, color: '#475569' }}>
          From<br />
          <input type="date" value={start} onChange={e => setStart(e.target.value)} style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13 }} />
        </label>
        <label style={{ fontSize: 12, color: '#475569' }}>
          To<br />
          <input type="date" value={end} onChange={e => setEnd(e.target.value)} style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13 }} />
        </label>
        <button type="submit" className="admin-btn admin-btn-primary" style={{ fontSize: 13 }}>Apply</button>
      </form>

      <ErrorBanner error={summary.result && !summary.result.success ? summary.result.error : null} />

      <div className="admin-stats-grid" style={{ marginBottom: 20 }}>
        <Kpi label="Revenue" value={sum.revenue != null ? num(sum.revenue) : num(sum.sale_amount)} />
        <Kpi label="Commission" value={num(sum.commission ?? sum.earnings)} />
        <Kpi label="Clicks" value={num(sum.clicks ?? sum.total_clicks)} />
        <Kpi label="Conversions" value={num(sum.conversions ?? sum.sales ?? sum.transactions)} />
        <Kpi label="Conv. rate" value={sum.conversion_rate != null ? `${num(sum.conversion_rate)}` : '—'} />
        <Kpi label="EPC" value={sum.epc != null ? num(sum.epc) : '—'} />
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {tabs.map(t => (
          <button key={t.key} type="button"
            onClick={() => { setView(t.key); setPage(1); }}
            className={`admin-btn ${view === t.key ? 'admin-btn-primary' : 'admin-btn-secondary'}`}
            style={{ fontSize: 12 }}>
            {t.label}
          </button>
        ))}
      </div>

      <ErrorBanner error={table.result && !table.result.success ? table.result.error : null} />
      {table.loading && <Spinner label={`Loading ${view}…`} />}

      {table.result?.success && (
        <>
          <GenericTable rows={rows} maxCols={7} />
          {rows.length > 0 && <Pagination page={page} perPage={perPage} total={total} onPage={setPage} />}
        </>
      )}
    </div>
  );
}
