import { useEffect, useMemo, useState } from 'react';

// ── Phase 2: assumptions data model ─────────────────────────────────────
// Six knobs the user can tune live. Defaults are deliberately conservative
// so the chart doesn't lie about a hockey-stick — admins can dial each
// number up to model upside scenarios.
interface Assumptions {
  /** Monthly Active Users at month 1. The chart scales this by mauGrowth
   *  month-over-month for the rest of the 16-month horizon. */
  mauStart: number;
  /** Monthly compounding growth rate on MAU (e.g. 0.20 = 20% MoM). */
  mauGrowth: number;
  /** Average order value in dollars on a converted product. */
  avgCostPerSale: number;
  /** Affiliate commission rate (e.g. 0.10 = 10% of order value). */
  avgAffiliateCommission: number;
  /** Average session length in minutes. Used as a sanity-check input;
   *  the revenue formula uses impressions per session directly. */
  sessionTimeMinutes: number;
  /** Average ad/product impressions per session. */
  avgImpressionsPerSession: number;
  /** Conversion rate per impression on a product (e.g. 0.01 = 1%). */
  productConversion: number;
  /** Average sessions per active user per month. */
  sessionsPerUserPerMonth: number;
}

const DEFAULTS: Assumptions = {
  mauStart: 5_000,
  mauGrowth: 0.18,
  avgCostPerSale: 85,
  avgAffiliateCommission: 0.10,
  sessionTimeMinutes: 4.5,
  avgImpressionsPerSession: 24,
  productConversion: 0.012,
  sessionsPerUserPerMonth: 8,
};

const STORAGE_KEY = 'catalog:projections:assumptions:v1';
const MONTHS = 16;

function readStored(): Assumptions {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

// ── Phase 3: revenue formula ────────────────────────────────────────────
// monthly revenue =
//   MAU(m)
//   × sessions/user/month
//   × impressions/session
//   × productConversion
//   × avgCostPerSale
//   × avgAffiliateCommission
//
// MAU compounds at mauGrowth month-over-month.
function projectMonth(a: Assumptions, monthIndex: number): number {
  const mau = a.mauStart * Math.pow(1 + a.mauGrowth, monthIndex);
  const monthlySessions = mau * a.sessionsPerUserPerMonth;
  const monthlyImpressions = monthlySessions * a.avgImpressionsPerSession;
  const monthlySales = monthlyImpressions * a.productConversion;
  const monthlyGmv = monthlySales * a.avgCostPerSale;
  const monthlyRevenue = monthlyGmv * a.avgAffiliateCommission;
  return monthlyRevenue;
}

const monthLabel = (i: number): string => {
  // Anchor month 1 to the current month so the X axis reads correctly
  // regardless of when the page loads.
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + i);
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};

const fmtCurrency = (n: number, opts: { compact?: boolean } = {}): string => {
  if (opts.compact) {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
    if (n >= 1_000)     return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
    return `$${Math.round(n)}`;
  }
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
};

const fmtPercent = (n: number, digits = 1): string =>
  `${(n * 100).toFixed(digits)}%`;

const fmtNumber = (n: number): string =>
  Math.round(n).toLocaleString('en-US');

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
  { key: 'mauStart',                 label: 'MAU (month 1)',          hint: 'Monthly active users at start',    format: 'integer',  step: 100,    min: 0 },
  { key: 'mauGrowth',                label: 'MAU growth (MoM)',       hint: 'Compounding month-over-month',     format: 'percent',  step: 0.01,   min: -0.5, max: 1 },
  { key: 'avgCostPerSale',           label: 'Avg cost per sale',      hint: 'Average order value',              format: 'currency', step: 5,      min: 0 },
  { key: 'avgAffiliateCommission',   label: 'Avg affiliate commission', hint: 'Take rate per sale',             format: 'percent',  step: 0.005,  min: 0, max: 0.5 },
  { key: 'sessionTimeMinutes',       label: 'Session time (min)',     hint: 'Average session length',           format: 'number',   step: 0.5,    min: 0 },
  { key: 'avgImpressionsPerSession', label: 'Impressions / session',  hint: 'Product views per session',        format: 'integer',  step: 1,      min: 0 },
  { key: 'productConversion',        label: 'Product conversion',     hint: 'Sale per impression',              format: 'percent',  step: 0.001,  min: 0, max: 0.5 },
  { key: 'sessionsPerUserPerMonth',  label: 'Sessions / user / mo',   hint: 'Avg sessions per MAU per month',   format: 'number',   step: 0.5,    min: 0 },
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

// ── Phase 5/6: SVG chart ───────────────────────────────────────────────
interface ChartProps {
  series: number[]; // length === MONTHS
}

function RevenueChart({ series }: ChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Logical SVG canvas — 1200×420 with padding for axis labels.
  const W = 1200, H = 420;
  const PAD_L = 70, PAD_R = 24, PAD_T = 24, PAD_B = 44;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const max = Math.max(1, ...series);
  // Round Y axis ceiling up to a "nice" number so gridlines read cleanly.
  const niceMax = niceCeiling(max);

  const xFor = (i: number) => PAD_L + (innerW * i) / (MONTHS - 1);
  const yFor = (v: number) => PAD_T + innerH - (innerH * v) / niceMax;

  // Gridlines — 5 horizontal divisions.
  const gridSteps = [0, 0.25, 0.5, 0.75, 1];

  // Smooth area path through the data points using monotonic cubic curves.
  const areaPath = useMemo(() => {
    if (series.length === 0) return '';
    const points = series.map((v, i) => ({ x: xFor(i), y: yFor(v) }));
    let d = `M ${points[0].x} ${PAD_T + innerH} L ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      const cp1x = p0.x + (p1.x - p0.x) / 2;
      const cp2x = cp1x;
      d += ` C ${cp1x} ${p0.y}, ${cp2x} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    d += ` L ${points[points.length - 1].x} ${PAD_T + innerH} Z`;
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series.join('|'), niceMax]);

  const linePath = useMemo(() => {
    if (series.length === 0) return '';
    const points = series.map((v, i) => ({ x: xFor(i), y: yFor(v) }));
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      const cp1x = p0.x + (p1.x - p0.x) / 2;
      const cp2x = cp1x;
      d += ` C ${cp1x} ${p0.y}, ${cp2x} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series.join('|'), niceMax]);

  return (
    <div className="proj-chart-wrap">
      <svg className="proj-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="proj-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#10b981" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.04" />
          </linearGradient>
        </defs>

        {/* Y axis grid + labels */}
        {gridSteps.map((t, i) => {
          const y = PAD_T + innerH * (1 - t);
          return (
            <g key={`grid-${i}`}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#e5e7eb" strokeDasharray="3 4" />
              <text x={PAD_L - 10} y={y + 4} textAnchor="end" fontSize="11" fill="#6b7280">
                {fmtCurrency(niceMax * t, { compact: true })}
              </text>
            </g>
          );
        })}

        {/* Area + line */}
        <path d={areaPath} fill="url(#proj-grad)" />
        <path d={linePath} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

        {/* Data points + hover hit-zones */}
        {series.map((v, i) => {
          const x = xFor(i);
          const y = yFor(v);
          const isHover = hoverIdx === i;
          return (
            <g key={`pt-${i}`}>
              <circle cx={x} cy={y} r={isHover ? 5 : 3.5} fill="#fff" stroke="#10b981" strokeWidth="2" />
              <rect
                x={x - 28} y={PAD_T} width={56} height={innerH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(prev => (prev === i ? null : prev))}
                style={{ cursor: 'pointer' }}
              />
              {/* X axis label */}
              <text
                x={x} y={H - PAD_B + 18}
                textAnchor="middle" fontSize="10" fill="#6b7280"
                style={{ fontWeight: isHover ? 700 : 500 }}
              >
                {monthLabel(i)}
              </text>
              {/* Hover tooltip */}
              {isHover && (
                <g>
                  <line x1={x} y1={PAD_T} x2={x} y2={PAD_T + innerH} stroke="#10b981" strokeDasharray="2 3" />
                  <g transform={`translate(${Math.min(W - PAD_R - 140, Math.max(PAD_L, x - 70))}, ${Math.max(PAD_T, y - 64)})`}>
                    <rect width="140" height="48" rx="8" fill="#0f172a" />
                    <text x="12" y="20" fontSize="11" fill="#cbd5e1">{monthLabel(i)}</text>
                    <text x="12" y="38" fontSize="14" fontWeight="700" fill="#fff">
                      {fmtCurrency(v)}
                    </text>
                  </g>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function niceCeiling(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const ratio = v / base;
  let nice: number;
  if (ratio < 1.5)      nice = 1.5;
  else if (ratio < 2)   nice = 2;
  else if (ratio < 2.5) nice = 2.5;
  else if (ratio < 3)   nice = 3;
  else if (ratio < 5)   nice = 5;
  else if (ratio < 7.5) nice = 7.5;
  else                  nice = 10;
  return nice * base;
}

// ── Phase 8: summary stats ─────────────────────────────────────────────
interface Summary {
  total: number;
  finalMonth: number;
  finalRunRate: number;
  cagrEquivalent: number;
}

function summarize(series: number[]): Summary {
  const total = series.reduce((acc, v) => acc + v, 0);
  const finalMonth = series[series.length - 1] ?? 0;
  const finalRunRate = finalMonth * 12;
  const first = series[0] ?? 0;
  const months = series.length;
  // Annualized growth from month 1 → month N. Months → years.
  const years = Math.max(1 / 12, (months - 1) / 12);
  const cagrEquivalent = first > 0 ? Math.pow(finalMonth / first, 1 / years) - 1 : 0;
  return { total, finalMonth, finalRunRate, cagrEquivalent };
}

export default function AdminProjections() {
  const [a, setA] = useState<Assumptions>(() => readStored());

  // Phase 7: persist on every change.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
    } catch { /* quota — chart still works in-memory */ }
  }, [a]);

  const series = useMemo(() => {
    return Array.from({ length: MONTHS }, (_, i) => projectMonth(a, i));
  }, [a]);

  const summary = useMemo(() => summarize(series), [series]);

  const set = <K extends keyof Assumptions>(k: K, v: number) => {
    setA(prev => ({ ...prev, [k]: v }));
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1>Projections</h1>
          <p className="admin-page-subtitle">16-month revenue model — drag the assumptions to reshape the curve.</p>
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

      {/* Summary stats — sit between assumptions and chart so the eye can read
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

      <RevenueChart series={series} />

      {/* Tiny legend / formula reminder — keeps the page honest about
           where the numbers come from so anyone reviewing the chart can
           reconstruct it without reading the code. */}
      <p className="proj-formula" aria-label="Revenue formula">
        <strong>Revenue</strong> = MAU × sessions/user × impressions/session × conversion × avg sale × commission
        &nbsp;·&nbsp;
        <span>MAU compounds at <strong>{fmtPercent(a.mauGrowth)}</strong> MoM</span>
        &nbsp;·&nbsp;
        <span>Month 1 MAU: <strong>{fmtNumber(a.mauStart)}</strong></span>
        &nbsp;·&nbsp;
        <span>Month {MONTHS} MAU: <strong>{fmtNumber(a.mauStart * Math.pow(1 + a.mauGrowth, MONTHS - 1))}</strong></span>
      </p>
    </div>
  );
}
