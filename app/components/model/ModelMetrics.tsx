import type { InvestorMetrics } from '~/services/model-metrics';
import type { Summary } from '~/services/projections';
import type { GtmSummary } from '~/services/go-to-market';
import { fmtCurrency, fmtNumber, fmtPercent } from '~/services/projections';

// One minimal "facts" card that sits above the graph — consolidates every
// headline result into a single bordered grid instead of a wall of cards.
export default function ModelMetrics({
  metrics,
  revSummary,
  acqSummary,
  totalSales,
}: {
  metrics: InvestorMetrics;
  revSummary: Summary;
  acqSummary: GtmSummary;
  totalSales: number;
}) {
  const item = (label: string, value: string, sub?: string, tone?: 'good' | 'warn') => (
    <div className={`model-metric${tone ? ` model-metric-${tone}` : ''}`}>
      <span className="model-metric-label">{label}</span>
      <span className="model-metric-value">{value}</span>
      {sub && <span className="model-metric-sub">{sub}</span>}
    </div>
  );

  return (
    <div className="model-metrics">
      {item('Exit ARR', fmtCurrency(metrics.exitArr))}
      {item('16-mo revenue', fmtCurrency(revSummary.total))}
      {item('GMV', fmtCurrency(metrics.gmvTotal, { compact: true }), `${fmtPercent(metrics.takeRate, 0)} take`)}
      {item('Total sales', fmtNumber(totalSales))}
      {item('Avg MAU', fmtNumber(acqSummary.avgMau), `DAU ${fmtNumber(acqSummary.avgDau)}`)}
      {item('LTV', fmtCurrency(metrics.ltv))}
      {item('Blended CAC', fmtCurrency(acqSummary.blendedCac), `${fmtPercent(acqSummary.organicShare, 0)} organic`)}
      {item('LTV : CAC', `${metrics.ltvCac.toFixed(1)}×`, metrics.ltvCac >= 3 ? '≥3× healthy' : 'below 3×', metrics.ltvCac >= 3 ? 'good' : 'warn')}
      {item('CAC payback', `${metrics.paybackMonths.toFixed(1)} mo`)}
      {item('Avg burn', `${fmtCurrency(metrics.avgBurn, { compact: true })}/mo`)}
      {item('Cash (M16)', fmtCurrency(metrics.cashEnd, { compact: true }))}
      {item('Runway', metrics.runwayMonths == null ? '16+ mo' : `${metrics.runwayMonths} mo`, metrics.runwayMonths == null ? 'survives' : 'cash-out', metrics.runwayMonths == null ? 'good' : 'warn')}
    </div>
  );
}
