// Shared data model for the 16-month revenue projection. Lives here
// (not in the admin/projections route) so the deck-v1.2 Projections
// slide can read the same assumptions out of localStorage and render
// the same curve as the admin tool. Changes the admin makes on
// /admin/projections are picked up by the deck on next mount.

export interface Assumptions {
  /** Monthly Active Users at month 1. */
  mauStart: number;
  /** Starting MoM MAU growth rate (e.g. 0.40 = 40%). */
  mauGrowthStart: number;
  /** Steady-state MoM MAU growth rate at the final month. */
  mauGrowthEnd: number;
  /** Average order value in dollars on a converted product. */
  avgCostPerSale: number;
  /** Affiliate commission rate (e.g. 0.10 = 10% of order value). */
  avgAffiliateCommission: number;
  /** Average session length in minutes (sanity-check input). */
  sessionTimeMinutes: number;
  /** Average product impressions per session. */
  avgImpressionsPerSession: number;
  /** Conversion rate per impression on a product (e.g. 0.01 = 1%). */
  productConversion: number;
  /** Average sessions per active user per month. */
  sessionsPerUserPerMonth: number;
}

export const DEFAULTS: Assumptions = {
  mauStart: 5_000,
  mauGrowthStart: 0.40,
  mauGrowthEnd:   0.10,
  avgCostPerSale: 85,
  avgAffiliateCommission: 0.10,
  sessionTimeMinutes: 4.5,
  avgImpressionsPerSession: 24,
  productConversion: 0.012,
  sessionsPerUserPerMonth: 8,
};

export const STORAGE_KEY = 'catalog:projections:assumptions:v2';
export const MONTHS = 16;

export function readStored(): Assumptions {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    }
    // v1 migration - the old shape stored a single `mauGrowth`. Map it
    // into the new start/end pair so admins keep their tuning when the
    // new build first loads.
    const legacyRaw = window.localStorage.getItem('catalog:projections:assumptions:v1');
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as { mauGrowth?: number } & Partial<Assumptions>;
      const flat = typeof legacy.mauGrowth === 'number' ? legacy.mauGrowth : DEFAULTS.mauGrowthStart;
      return { ...DEFAULTS, ...legacy, mauGrowthStart: flat, mauGrowthEnd: flat };
    }
    return DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export interface MonthBreakdown {
  monthIndex: number;
  /** Effective MoM growth rate applied at this month's transition. */
  mauGrowthApplied: number;
  mau: number;
  sessions: number;
  impressions: number;
  sales: number;
  gmv: number;
  revenue: number;
}

function growthRateAtTransition(a: Assumptions, transitionIndex: number): number {
  const lastIdx = Math.max(1, MONTHS - 2);
  const t = Math.min(1, Math.max(0, transitionIndex / lastIdx));
  return a.mauGrowthStart + (a.mauGrowthEnd - a.mauGrowthStart) * t;
}

export function buildSeries(a: Assumptions): MonthBreakdown[] {
  const out: MonthBreakdown[] = [];
  let mau = a.mauStart;
  for (let i = 0; i < MONTHS; i++) {
    let appliedGrowth = 0;
    if (i > 0) {
      appliedGrowth = growthRateAtTransition(a, i - 1);
      mau = mau * (1 + appliedGrowth);
    }
    const sessions = mau * a.sessionsPerUserPerMonth;
    const impressions = sessions * a.avgImpressionsPerSession;
    const sales = impressions * a.productConversion;
    const gmv = sales * a.avgCostPerSale;
    const revenue = gmv * a.avgAffiliateCommission;
    out.push({ monthIndex: i, mauGrowthApplied: appliedGrowth, mau, sessions, impressions, sales, gmv, revenue });
  }
  return out;
}

export const monthLabel = (i: number): string => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + i);
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};

export const fmtCurrency = (n: number, opts: { compact?: boolean } = {}): string => {
  if (opts.compact) {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
    if (n >= 1_000)     return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
    return `$${Math.round(n)}`;
  }
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
};

export const fmtPercent = (n: number, digits = 1): string =>
  `${(n * 100).toFixed(digits)}%`;

export const fmtNumber = (n: number): string =>
  Math.round(n).toLocaleString('en-US');

export function niceCeiling(v: number): number {
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

export interface Summary {
  total: number;
  finalMonth: number;
  finalRunRate: number;
  cagrEquivalent: number;
}

export function summarize(series: MonthBreakdown[]): Summary {
  const total = series.reduce((acc, s) => acc + s.revenue, 0);
  const finalMonth = series[series.length - 1]?.revenue ?? 0;
  const finalRunRate = finalMonth * 12;
  const first = series[0]?.revenue ?? 0;
  const months = series.length;
  const years = Math.max(1 / 12, (months - 1) / 12);
  const cagrEquivalent = first > 0 ? Math.pow(finalMonth / first, 1 / years) - 1 : 0;
  return { total, finalMonth, finalRunRate, cagrEquivalent };
}
