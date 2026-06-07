// Investor-facing derived metrics layered on top of the revenue +
// acquisition models. Everything here is a *result* computed from the
// existing assumptions — LTV / CAC, payback, GMV & take-rate, the cash
// runway, a sensitivity sweep, cohort retention and the scenario presets.

import {
  type Assumptions,
  type MonthBreakdown,
  DEFAULTS,
  MONTHS,
  buildSeries,
  summarize,
} from './projections';
import {
  type GtmAssumptions,
  type GtmMonth,
  type GtmSummary,
  GTM_DEFAULTS,
  buildGtmSeries,
  summarizeGtm,
} from './go-to-market';
import { buildModel } from './model';

// ── Economics (costs + cash) ────────────────────────────────────
export interface EconAssumptions {
  /** Gross margin on revenue (0..1). */
  grossMargin: number;
  /** Fixed monthly operating expense in dollars. */
  monthlyOpex: number;
  /** Cash on hand at month 0 — i.e. the raise. */
  startingCash: number;
}
export const ECON_DEFAULTS: EconAssumptions = {
  grossMargin: 0.85,
  monthlyOpex: 60_000,
  startingCash: 1_500_000,
};
export const ECON_STORAGE_KEY = 'catalog:model:econ:v1';

export function readEconStored(): EconAssumptions {
  if (typeof window === 'undefined') return ECON_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(ECON_STORAGE_KEY);
    return raw ? { ...ECON_DEFAULTS, ...JSON.parse(raw) } : ECON_DEFAULTS;
  } catch { return ECON_DEFAULTS; }
}

// ── Cash flow ───────────────────────────────────────────────────
export interface CashMonth {
  monthIndex: number;
  revenue: number;
  grossProfit: number;
  marketing: number;
  opex: number;
  net: number;
  cash: number;
}

export function buildCashflow(
  revenue: MonthBreakdown[],
  acquisition: GtmMonth[],
  econ: EconAssumptions,
): CashMonth[] {
  const out: CashMonth[] = [];
  let cash = econ.startingCash;
  for (let i = 0; i < revenue.length; i++) {
    const rev = revenue[i].revenue;
    const grossProfit = rev * econ.grossMargin;
    const marketing = acquisition[i]?.spend ?? 0;
    const opex = econ.monthlyOpex;
    const net = grossProfit - marketing - opex;
    cash += net;
    out.push({ monthIndex: i, revenue: rev, grossProfit, marketing, opex, net, cash });
  }
  return out;
}

// ── Headline investor metrics ───────────────────────────────────
const LIFETIME_CAP_MONTHS = 60;

export interface InvestorMetrics {
  exitArr: number;
  avgArpu: number;
  ltv: number;
  ltvCac: number;
  paybackMonths: number;
  gmvTotal: number;
  takeRate: number;
  avgBurn: number;
  runwayMonths: number | null; // null = never runs out within the horizon
  cashEnd: number;
  breakevenMonth: number | null;
}

export function investorMetrics(
  rev: Assumptions,
  acq: GtmAssumptions,
  revenue: MonthBreakdown[],
  acquisition: GtmMonth[],
  acqSummary: GtmSummary,
  econ: EconAssumptions,
  cash: CashMonth[],
): InvestorMetrics {
  const finalRev = revenue[revenue.length - 1]?.revenue ?? 0;
  const exitArr = finalRev * 12;

  // ARPU: mean monthly revenue per active user across the horizon.
  let arpuSum = 0, cnt = 0;
  for (const m of revenue) {
    const mau = acquisition[m.monthIndex]?.cumulativeUsers ?? 0;
    if (mau > 0) { arpuSum += m.revenue / mau; cnt++; }
  }
  const avgArpu = cnt ? arpuSum / cnt : 0;

  const lifetime = acq.churn > 0 ? Math.min(LIFETIME_CAP_MONTHS, 1 / acq.churn) : LIFETIME_CAP_MONTHS;
  const contribPerUser = avgArpu * econ.grossMargin;
  const ltv = contribPerUser * lifetime;
  const ltvCac = acqSummary.blendedCac > 0 ? ltv / acqSummary.blendedCac : 0;
  const paybackMonths = contribPerUser > 0 ? acqSummary.blendedCac / contribPerUser : 0;

  const gmvTotal = revenue.reduce((a, m) => a + m.gmv, 0);
  const takeRate = rev.avgAffiliateCommission;

  const burns = cash.map(c => c.net).filter(n => n < 0).map(n => -n);
  const avgBurn = burns.length ? burns.reduce((a, b) => a + b, 0) / burns.length : 0;
  let runwayMonths: number | null = null;
  for (const c of cash) { if (c.cash <= 0) { runwayMonths = c.monthIndex; break; } }
  const cashEnd = cash[cash.length - 1]?.cash ?? econ.startingCash;
  let breakevenMonth: number | null = null;
  for (const c of cash) { if (c.net >= 0) { breakevenMonth = c.monthIndex; break; } }

  return { exitArr, avgArpu, ltv, ltvCac, paybackMonths, gmvTotal, takeRate, avgBurn, runwayMonths, cashEnd, breakevenMonth };
}

// ── Sensitivity (tornado) ───────────────────────────────────────
export interface SensitivityRow {
  key: string;
  label: string;
  low: number;
  high: number;
  swing: number;
}

const exitArrFor = (rev: Assumptions, acq: GtmAssumptions): number =>
  summarize(buildModel(rev, acq, true).revenue).finalRunRate;

// Sweeps each key lever ±delta and reports the resulting exit-ARR range,
// sorted by swing so the biggest drivers sit at the top of the tornado.
export function sensitivity(rev: Assumptions, acq: GtmAssumptions, delta = 0.2): SensitivityRow[] {
  const scale = (factor: number) => ({
    cpa:        () => ({ rev, acq: { ...acq, cpa: acq.cpa * factor } }),
    conversion: () => ({ rev: { ...rev, productConversion: rev.productConversion * factor }, acq }),
    churn:      () => ({ rev, acq: { ...acq, churn: Math.min(1, acq.churn * factor) } }),
    organic:    () => ({ rev, acq: { ...acq, organicGrowth: acq.organicGrowth * factor } }),
    aov:        () => ({ rev: { ...rev, avgCostPerSale: rev.avgCostPerSale * factor }, acq }),
    spend:      () => ({ rev, acq: { ...acq, budget: acq.budget * factor } }),
  });
  const labels: Record<string, string> = {
    cpa: 'CPA', conversion: 'Conversion', churn: 'Churn',
    organic: 'Organic growth', aov: 'Avg order value', spend: 'Ad spend',
  };
  return Object.keys(labels).map(key => {
    const lo = scale(1 - delta)[key as keyof ReturnType<typeof scale>]();
    const hi = scale(1 + delta)[key as keyof ReturnType<typeof scale>]();
    const low = exitArrFor(lo.rev, lo.acq);
    const high = exitArrFor(hi.rev, hi.acq);
    return { key, label: labels[key], low, high, swing: Math.abs(high - low) };
  }).sort((a, b) => b.swing - a.swing);
}

// ── Cohort retention curve ──────────────────────────────────────
export function cohortRetention(churn: number, months = MONTHS): number[] {
  const c = Math.min(1, Math.max(0, churn));
  return Array.from({ length: months }, (_, m) => Math.pow(1 - c, m));
}

// ── Scenarios (Base is the source of truth; Bear/Bull derive from it) ─
// Only the Base case is editable. Bear and Bull are computed by applying
// directional multipliers to whatever Base the user entered — so they
// always stay relative to the real plan and can't drift on their own.
export type ScenarioId = 'bear' | 'base' | 'bull';

export interface ScenarioValues { rev: Assumptions; acq: GtmAssumptions; econ: EconAssumptions; }

interface Factors {
  rev: Partial<Record<keyof Assumptions, number>>;
  acq: Partial<Record<keyof GtmAssumptions, number>>;
  econ: Partial<Record<keyof EconAssumptions, number>>;
}

const SCENARIO_FACTORS: Record<'bear' | 'bull', Factors> = {
  bear: {
    rev: { productConversion: 0.6, avgCostPerSale: 0.85, avgAffiliateCommission: 0.85, sessionsPerUserPerMonth: 0.85, avgImpressionsPerSession: 0.85 },
    acq: { cpa: 1.6, organicGrowth: 0.5, budget: 0.7, churn: 1.8 },
    econ: { grossMargin: 0.92, monthlyOpex: 1.3, startingCash: 0.8 },
  },
  bull: {
    rev: { productConversion: 1.6, avgCostPerSale: 1.2, avgAffiliateCommission: 1.2, sessionsPerUserPerMonth: 1.15, avgImpressionsPerSession: 1.15 },
    acq: { cpa: 0.6, organicGrowth: 1.5, budget: 1.4, churn: 0.5 },
    econ: { grossMargin: 1.05, monthlyOpex: 0.9, startingCash: 1.3 },
  },
};

// Fields that are rates and must stay within [0, 1] after scaling.
const RATE_KEYS = new Set(['productConversion', 'avgAffiliateCommission', 'organicGrowth', 'churn', 'grossMargin', 'budgetDistEarly', 'budgetDistLate']);

function scaleSet<T extends object>(base: T, factors: Partial<Record<keyof T, number>>): T {
  const out = { ...base } as Record<string, number>;
  for (const k of Object.keys(out)) {
    const f = (factors as Record<string, number | undefined>)[k];
    if (f === undefined) continue;
    let v = out[k] * f;
    if (RATE_KEYS.has(k)) v = Math.min(1, Math.max(0, v));
    out[k] = v;
  }
  return out as T;
}

export function deriveScenario(base: ScenarioValues, id: ScenarioId): ScenarioValues {
  if (id === 'base') return base;
  const f = SCENARIO_FACTORS[id];
  return {
    rev: scaleSet(base.rev, f.rev),
    acq: scaleSet(base.acq, f.acq),
    econ: scaleSet(base.econ, f.econ),
  };
}

// ── CSV export of the full monthly funnel + cash flow ───────────
export function toCsv(revenue: MonthBreakdown[], acquisition: GtmMonth[], cash: CashMonth[]): string {
  const head = ['Month', 'MAU', 'DAU', 'New users', 'Churned', 'Sessions', 'Impressions', 'Sales', 'GMV', 'Revenue', 'Marketing', 'Net', 'Cash'];
  const rows = revenue.map((m, i) => {
    const a = acquisition[i];
    const c = cash[i];
    return [
      i + 1,
      Math.round(a.cumulativeUsers), Math.round(a.dau), Math.round(a.newUsers), Math.round(a.churned),
      Math.round(m.sessions), Math.round(m.impressions), Math.round(m.sales),
      Math.round(m.gmv), Math.round(m.revenue), Math.round(c.marketing), Math.round(c.net), Math.round(c.cash),
    ].join(',');
  });
  return [head.join(','), ...rows].join('\n');
}
