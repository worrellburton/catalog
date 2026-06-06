import type { MonthBreakdown } from '~/services/projections';
import type { GtmMonth } from '~/services/go-to-market';
import { monthLabel, fmtCurrency, fmtNumber, fmtPercent } from '~/services/projections';

// The full monthly funnel, MAU → sessions → impressions → sales → GMV →
// revenue, with the per-step conversion so every number is auditable.
export default function FunnelTable({ revenue, acquisition }: { revenue: MonthBreakdown[]; acquisition: GtmMonth[] }) {
  return (
    <div className="funnel-table-wrap">
      <table className="funnel-table">
        <thead>
          <tr>
            <th>Month</th><th>MAU</th><th>Sessions</th><th>Impressions</th>
            <th>Sales</th><th>Conv.</th><th>GMV</th><th>Revenue</th>
          </tr>
        </thead>
        <tbody>
          {revenue.map((m, i) => (
            <tr key={i}>
              <td>{monthLabel(i)}</td>
              <td>{fmtNumber(acquisition[i].cumulativeUsers)}</td>
              <td>{fmtNumber(m.sessions)}</td>
              <td>{fmtNumber(m.impressions)}</td>
              <td>{fmtNumber(m.sales)}</td>
              <td>{m.impressions > 0 ? fmtPercent(m.sales / m.impressions, 2) : '—'}</td>
              <td>{fmtCurrency(m.gmv, { compact: true })}</td>
              <td>{fmtCurrency(m.revenue, { compact: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
