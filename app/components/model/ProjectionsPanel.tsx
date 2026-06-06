import { useEffect, useMemo, useState } from 'react';
import {
  type Assumptions,
  type MonthBreakdown,
  DEFAULTS,
  MONTHS,
  STORAGE_KEY,
  buildSeries,
  fmtCurrency,
  fmtNumber,
  fmtPercent,
  readStored,
  summarize,
} from '~/services/projections';
import ProjectionsChart from '~/components/ProjectionsChart';
import AssumptionCard, { type FieldDef } from '~/components/model/AssumptionCard';

const FIELDS: FieldDef[] = [
  { key: 'mauStart',                 label: 'MAU (month 1)',          hint: 'Monthly active users at start',         format: 'integer',  step: 100,    min: 0 },
  { key: 'mauGrowthStart',           label: 'MAU growth (early)',     hint: 'MoM in the first month',                format: 'percent',  step: 0.01,   min: -0.5, max: 1 },
  { key: 'mauGrowthEnd',             label: 'MAU growth (late)',      hint: 'MoM in the final month - model tapers', format: 'percent',  step: 0.01,   min: -0.5, max: 1 },
  { key: 'avgCostPerSale',           label: 'Avg cost per sale',      hint: 'Average order value',                   format: 'currency', step: 5,      min: 0 },
  { key: 'avgAffiliateCommission',   label: 'Avg affiliate commission', hint: 'Take rate per sale',                  format: 'percent',  step: 0.005,  min: 0, max: 0.5 },
  { key: 'sessionTimeMinutes',       label: 'Session time (min)',     hint: 'Average session length',                format: 'number',   step: 0.5,    min: 0 },
  { key: 'avgImpressionsPerSession', label: 'Impressions / session',  hint: 'Product views per session',             format: 'integer',  step: 1,      min: 0 },
  { key: 'productConversion',        label: 'Product conversion',     hint: 'Sale per impression',                   format: 'percent',  step: 0.001,  min: 0, max: 0.5 },
  { key: 'sessionsPerUserPerMonth',  label: 'Sessions / user / mo',   hint: 'Avg sessions per MAU per month',        format: 'number',   step: 0.5,    min: 0 },
];

export default function ProjectionsPanel() {
  const [a, setA] = useState<Assumptions>(() => readStored());

  // Persist on every change so the deck-v1.2 Projections slide can read
  // the same assumptions out of localStorage.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
    } catch { /* quota - chart still works in-memory */ }
  }, [a]);

  const series = useMemo<MonthBreakdown[]>(() => buildSeries(a), [a]);
  const summary = useMemo(() => summarize(series), [series]);

  const set = (k: keyof Assumptions, v: number) => {
    setA(prev => ({ ...prev, [k]: v }));
  };

  return (
    <>
      <div className="model-panel-head">
        <p className="admin-page-subtitle">16-month revenue model - drag the assumptions to reshape the curve.</p>
        <button
          className="admin-btn admin-btn-secondary"
          onClick={() => setA(DEFAULTS)}
          title="Reset every input to the conservative defaults"
        >
          Reset to defaults
        </button>
      </div>

      {/* Assumption cards */}
      <div className="proj-cards">
        {FIELDS.map(f => (
          <AssumptionCard
            key={f.key}
            field={f}
            value={a[f.key as keyof Assumptions]}
            onChange={(n) => set(f.key as keyof Assumptions, n)}
          />
        ))}
      </div>

      {/* Summary stats - sit between assumptions and chart so the eye can read
           "inputs → headline numbers → curve" top-down. */}
      <div className="proj-summary">
        <div className="proj-summary-card">
          <span className="proj-summary-label">16-month total revenue</span>
          <span className="proj-summary-value">{fmtCurrency(summary.total)}</span>
        </div>
        <div className="proj-summary-card">
          <span className="proj-summary-label">Final month revenue</span>
          <span className="proj-summary-value">{fmtCurrency(summary.finalMonth)}</span>
          <span className="proj-summary-sub">Month {MONTHS}</span>
        </div>
        <div className="proj-summary-card">
          <span className="proj-summary-label">Exit run-rate (ARR)</span>
          <span className="proj-summary-value">{fmtCurrency(summary.finalRunRate)}</span>
          <span className="proj-summary-sub">Final month × 12</span>
        </div>
        <div className="proj-summary-card">
          <span className="proj-summary-label">Implied CAGR</span>
          <span className="proj-summary-value">{fmtPercent(summary.cagrEquivalent, 0)}</span>
          <span className="proj-summary-sub">Month 1 → {MONTHS}</span>
        </div>
      </div>

      <ProjectionsChart series={series} />

      {/* Tiny legend / formula reminder - keeps the page honest about
           where the numbers come from. */}
      <p className="proj-formula" aria-label="Revenue formula">
        <strong>Revenue</strong> = MAU × sessions/user × impressions/session × conversion × avg sale × commission
        &nbsp;·&nbsp;
        <span>
          MAU growth tapers <strong>{fmtPercent(a.mauGrowthStart)}</strong> → <strong>{fmtPercent(a.mauGrowthEnd)}</strong> MoM
        </span>
        &nbsp;·&nbsp;
        <span>Month 1 MAU: <strong>{fmtNumber(a.mauStart)}</strong></span>
        &nbsp;·&nbsp;
        <span>Month {MONTHS} MAU: <strong>{fmtNumber(series[series.length - 1]?.mau ?? a.mauStart)}</strong></span>
      </p>
    </>
  );
}
