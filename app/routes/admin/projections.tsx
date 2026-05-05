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

// ── Phase 4: assumption input cards ────────────────────────────────────
interface FieldDef {
  key: keyof Assumptions;
  label: string;
  hint: string;
  format: 'currency' | 'percent' | 'number' | 'integer';
  step: number;
  min?: number;
  max?: number;
}

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

function AssumptionCard({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: number;
  onChange: (next: number) => void;
}) {
  const [local, setLocal] = useState<string>(() => formatForInput(value, field.format));
  // Keep local state in sync if external value changes (e.g. reset to defaults).
  useEffect(() => {
    setLocal(formatForInput(value, field.format));
  }, [value, field.format]);

  return (
    <label className="proj-card">
      <span className="proj-card-label">{field.label}</span>
      <span className="proj-card-input-wrap">
        {field.format === 'currency' && <span className="proj-card-prefix">$</span>}
        <input
          type="number"
          className="proj-card-input"
          value={local}
          step={field.step}
          min={field.min}
          max={field.max}
          onChange={(e) => {
            setLocal(e.target.value);
            const n = parseInputToNumber(e.target.value, field.format);
            if (n !== null) onChange(n);
          }}
          onBlur={() => setLocal(formatForInput(value, field.format))}
        />
        {field.format === 'percent' && <span className="proj-card-suffix">%</span>}
      </span>
      <span className="proj-card-hint">{field.hint}</span>
    </label>
  );
}

function formatForInput(value: number, format: FieldDef['format']): string {
  if (format === 'percent') return (value * 100).toFixed(2);
  if (format === 'integer') return String(Math.round(value));
  return String(value);
}

function parseInputToNumber(raw: string, format: FieldDef['format']): number | null {
  const cleaned = raw.replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  if (Number.isNaN(n)) return null;
  if (format === 'percent') return n / 100;
  return n;
}

export default function AdminProjections() {
  const [a, setA] = useState<Assumptions>(() => readStored());

  // Phase 7: persist on every change.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
    } catch { /* quota - chart still works in-memory */ }
  }, [a]);

  const series = useMemo<MonthBreakdown[]>(() => buildSeries(a), [a]);

  const summary = useMemo(() => summarize(series), [series]);

  const set = <K extends keyof Assumptions>(k: K, v: number) => {
    setA(prev => ({ ...prev, [k]: v }));
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1>Projections</h1>
          <p className="admin-page-subtitle">16-month revenue model - drag the assumptions to reshape the curve.</p>
        </div>
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
            value={a[f.key]}
            onChange={(n) => set(f.key, n)}
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
           where the numbers come from so anyone reviewing the chart can
           reconstruct it without reading the code. */}
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
    </div>
  );
}
