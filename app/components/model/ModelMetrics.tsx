import { useState } from 'react';
import type { InvestorMetrics } from '~/services/model-metrics';
import type { EconAssumptions } from '~/services/model-metrics';
import type { Assumptions, Summary } from '~/services/projections';
import type { GtmAssumptions, GtmSummary } from '~/services/go-to-market';
import { DAU_MAU_RATIO } from '~/services/go-to-market';
import { MONTHS, fmtCurrency, fmtNumber, fmtPercent } from '~/services/projections';

interface MetricItem {
  label: string;
  value: string;
  sub?: string;
  tone?: 'good' | 'warn';
  detail: string;
}

// One minimal "facts" card above the graph. Hovering any cell pops a
// breakdown of how that number is calculated, with the live inputs filled
// in, so the figures are self-explaining in a meeting.
export default function ModelMetrics({
  metrics,
  revSummary,
  acqSummary,
  totalSales,
  rev,
  acq,
  econ,
}: {
  metrics: InvestorMetrics;
  revSummary: Summary;
  acqSummary: GtmSummary;
  totalSales: number;
  rev: Assumptions;
  acq: GtmAssumptions;
  econ: EconAssumptions;
}) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  const lifetime = acq.churn > 0 ? Math.min(60, 1 / acq.churn) : 60;
  const finalMonthRev = metrics.exitArr / 12;

  const items: MetricItem[] = [
    { label: 'Exit ARR', value: fmtCurrency(metrics.exitArr),
      detail: `Final-month revenue ${fmtCurrency(finalMonthRev)} × 12. The annualised run-rate you exit the 16 months on.` },
    { label: '16-mo revenue', value: fmtCurrency(revSummary.total),
      detail: `Sum of monthly affiliate revenue across all ${MONTHS} months.` },
    { label: 'GMV', value: fmtCurrency(metrics.gmvTotal, { compact: true }), sub: `${fmtPercent(metrics.takeRate, 0)} take`,
      detail: `Σ (sales × avg order value ${fmtCurrency(rev.avgCostPerSale)}). Your ${fmtPercent(metrics.takeRate, 0)} take rate of GMV is the revenue.` },
    { label: 'Total sales', value: fmtNumber(totalSales),
      detail: `Σ (impressions × ${fmtPercent(rev.productConversion, 2)} product conversion) each month.` },
    { label: 'Avg MAU', value: fmtNumber(acqSummary.avgMau), sub: `DAU ${fmtNumber(acqSummary.avgDau)}`,
      detail: `Mean monthly active users over ${MONTHS} months. DAU = MAU × ${fmtPercent(DAU_MAU_RATIO, 0)}.` },
    { label: 'LTV', value: fmtCurrency(metrics.ltv),
      detail: `ARPU ${fmtCurrency(metrics.avgArpu)}/mo × ${fmtPercent(econ.grossMargin, 0)} gross margin × ${lifetime.toFixed(0)}-mo lifetime (1 ÷ ${fmtPercent(acq.churn, 0)} churn).` },
    { label: 'Blended CAC', value: fmtCurrency(acqSummary.blendedCac), sub: `${fmtPercent(acqSummary.organicShare, 0)} organic`,
      detail: `Total ad spend ${fmtCurrency(acq.budget, { compact: true })} ÷ every user acquired (paid + organic). Organic users (${fmtPercent(acqSummary.organicShare, 0)}) cost nothing, pulling it below the ${fmtCurrency(acq.cpa)} paid CPA.` },
    { label: 'LTV : CAC', value: `${metrics.ltvCac.toFixed(1)}×`, sub: metrics.ltvCac >= 3 ? '≥3× healthy' : 'below 3×', tone: metrics.ltvCac >= 3 ? 'good' : 'warn',
      detail: `LTV ${fmtCurrency(metrics.ltv)} ÷ blended CAC ${fmtCurrency(acqSummary.blendedCac)}. ≥3× is the bar investors look for.` },
    { label: 'CAC payback', value: `${metrics.paybackMonths.toFixed(1)} mo`,
      detail: `Blended CAC ${fmtCurrency(acqSummary.blendedCac)} ÷ monthly gross profit per user (ARPU ${fmtCurrency(metrics.avgArpu)} × ${fmtPercent(econ.grossMargin, 0)} margin). Months to earn back the cost of a customer.` },
    { label: 'Avg burn', value: `${fmtCurrency(metrics.avgBurn, { compact: true })}/mo`,
      detail: `Average monthly net loss = marketing spend + OpEx (${fmtCurrency(econ.monthlyOpex, { compact: true })}/mo) − gross profit, across months that are cash-negative.` },
    { label: 'Cash (M16)', value: fmtCurrency(metrics.cashEnd, { compact: true }),
      detail: `Cash raised ${fmtCurrency(econ.startingCash, { compact: true })} + cumulative monthly net over ${MONTHS} months.${metrics.breakevenMonth == null ? '' : ` Break-even in month ${metrics.breakevenMonth + 1}.`}` },
    { label: 'Runway', value: metrics.runwayMonths == null ? '16+ mo' : `${metrics.runwayMonths} mo`, sub: metrics.runwayMonths == null ? 'survives' : 'cash-out', tone: metrics.runwayMonths == null ? 'good' : 'warn',
      detail: metrics.runwayMonths == null ? `Cash never hits zero within the ${MONTHS}-month horizon at this burn.` : `Cash hits zero in month ${metrics.runwayMonths} at this burn.` },
  ];

  const popLeft = hover ? Math.max(8, Math.min(hover.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 256)) : 0;

  return (
    <div className="model-metrics">
      {items.map((it, i) => (
        <div
          key={it.label}
          className={`model-metric${it.tone ? ` model-metric-${it.tone}` : ''}`}
          onMouseEnter={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setHover({ i, x: r.left, y: r.bottom });
          }}
          onMouseLeave={() => setHover(h => (h?.i === i ? null : h))}
        >
          <span className="model-metric-label">{it.label}</span>
          <span className="model-metric-value">{it.value}</span>
          {it.sub && <span className="model-metric-sub">{it.sub}</span>}
        </div>
      ))}
      {hover && (
        <div className="model-metric-pop" style={{ left: popLeft, top: hover.y + 6 }}>
          <div className="model-metric-pop-title">{items[hover.i].label}</div>
          <div className="model-metric-pop-body">{items[hover.i].detail}</div>
        </div>
      )}
    </div>
  );
}
