import { useEffect, useMemo, useState } from 'react';
import {
  type GtmAssumptions,
  GTM_DEFAULTS,
  GTM_STORAGE_KEY,
  buildGtmSeries,
  readGtmStored,
  summarizeGtm,
} from '~/services/go-to-market';
import { MONTHS, fmtCurrency, fmtNumber, fmtPercent } from '~/services/projections';
import GoToMarketChart from '~/components/GoToMarketChart';
import AssumptionCard, { type FieldDef } from '~/components/model/AssumptionCard';

const FIELDS: FieldDef[] = [
  { key: 'cpa',             label: 'CPA',                    hint: 'Cost per paid acquisition',             format: 'currency', step: 1,     min: 0 },
  { key: 'organicGrowth',   label: 'Organic growth',         hint: 'Word-of-mouth adds, % of base / mo',    format: 'percent',  step: 0.01,  min: 0, max: 1 },
  { key: 'budget',          label: 'Budget',                 hint: 'Total marketing spend, 16 months',      format: 'currency', step: 5000,  min: 0 },
  { key: 'budgetDistEarly', label: 'Budget distribution (early)', hint: 'Relative spend weight in month 1', format: 'number',   step: 0.1,   min: 0 },
  { key: 'budgetDistLate',  label: 'Budget distribution (late)',  hint: 'Relative spend weight in month 16', format: 'number',  step: 0.1,   min: 0 },
];

export default function GoToMarketPanel() {
  const [a, setA] = useState<GtmAssumptions>(() => readGtmStored());

  useEffect(() => {
    try {
      window.localStorage.setItem(GTM_STORAGE_KEY, JSON.stringify(a));
    } catch { /* quota - chart still works in-memory */ }
  }, [a]);

  const series = useMemo(() => buildGtmSeries(a), [a]);
  const summary = useMemo(() => summarizeGtm(series, a), [series, a]);

  const set = (k: keyof GtmAssumptions, v: number) => {
    setA(prev => ({ ...prev, [k]: v }));
  };

  // Whether spend is front- or back-loaded, phrased for the formula line.
  const loadShape =
    a.budgetDistLate > a.budgetDistEarly ? 'back-loaded'
    : a.budgetDistLate < a.budgetDistEarly ? 'front-loaded'
    : 'even';

  return (
    <>
      <div className="model-panel-head">
        <p className="admin-page-subtitle">16-month acquisition model - paid spend compounds with organic word of mouth.</p>
        <button
          className="admin-btn admin-btn-secondary"
          onClick={() => setA(GTM_DEFAULTS)}
          title="Reset every input to the default go-to-market plan"
        >
          Reset to defaults
        </button>
      </div>

      <div className="proj-cards gtm-cards">
        {FIELDS.map(f => (
          <AssumptionCard
            key={f.key}
            field={f}
            value={a[f.key as keyof GtmAssumptions]}
            onChange={(n) => set(f.key as keyof GtmAssumptions, n)}
          />
        ))}
      </div>

      {/* Headline dials */}
      <div className="proj-summary">
        <div className="proj-summary-card">
          <span className="proj-summary-label">Total users acquired</span>
          <span className="proj-summary-value">{fmtNumber(summary.totalUsers)}</span>
          <span className="proj-summary-sub">16-month cumulative</span>
        </div>
        <div className="proj-summary-card">
          <span className="proj-summary-label">Blended CAC</span>
          <span className="proj-summary-value">{fmtCurrency(summary.blendedCac)}</span>
          <span className="proj-summary-sub">vs {fmtCurrency(a.cpa)} paid CPA</span>
        </div>
        <div className="proj-summary-card">
          <span className="proj-summary-label">Organic share</span>
          <span className="proj-summary-value">{fmtPercent(summary.organicShare, 0)}</span>
          <span className="proj-summary-sub">of all users acquired</span>
        </div>
        <div className="proj-summary-card">
          <span className="proj-summary-label">Total spend</span>
          <span className="proj-summary-value">{fmtCurrency(summary.totalSpend)}</span>
          <span className="proj-summary-sub">across the budget</span>
        </div>
      </div>

      {/* Secondary dials */}
      <div className="proj-summary gtm-summary-sub">
        <div className="proj-summary-card gtm-dial-paid">
          <span className="proj-summary-label">Paid users</span>
          <span className="proj-summary-value">{fmtNumber(summary.totalPaid)}</span>
        </div>
        <div className="proj-summary-card gtm-dial-organic">
          <span className="proj-summary-label">Organic users</span>
          <span className="proj-summary-value">{fmtNumber(summary.totalOrganic)}</span>
        </div>
        <div className="proj-summary-card">
          <span className="proj-summary-label">CAC efficiency</span>
          <span className="proj-summary-value">{summary.cacEfficiency.toFixed(1)}×</span>
          <span className="proj-summary-sub">CPA ÷ blended CAC</span>
        </div>
        <div className="proj-summary-card">
          <span className="proj-summary-label">Exit monthly adds</span>
          <span className="proj-summary-value">{fmtNumber(summary.exitMonthlyAdds)}</span>
          <span className="proj-summary-sub">new users in month {MONTHS}</span>
        </div>
      </div>

      <GoToMarketChart series={series} />

      <p className="proj-formula" aria-label="Acquisition formula">
        <strong>Paid adds</strong> = monthly spend ÷ CPA
        &nbsp;·&nbsp;
        <strong>Organic adds</strong> = existing base × {fmtPercent(a.organicGrowth)} / mo
        &nbsp;·&nbsp;
        <span>Spend is <strong>{loadShape}</strong> ({a.budgetDistEarly} → {a.budgetDistLate})</span>
        &nbsp;·&nbsp;
        <span>Peak month: <strong>{fmtNumber(summary.peakMonthlyAdds)}</strong> adds</span>
      </p>
    </>
  );
}
