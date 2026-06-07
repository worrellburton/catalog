// Go-to-Market model. Sibling to the revenue projection in
// services/projections.ts — it answers a different question: given a
// marketing budget, a paid CPA and an organic word-of-mouth rate, how
// many users do we acquire over the same 16-month horizon, and how
// cheap does the blended CAC get as organic compounds on top of paid?
//
// Shares the horizon (MONTHS) and the formatters with projections so
// the two tabs of /admin/model speak the same units and read the same.

import { MONTHS } from './projections';

export interface GtmAssumptions {
  /** Paid cost per acquisition in dollars (spend ÷ paid users). */
  cpa: number;
  /** Organic word-of-mouth adds each month, as a % of the existing base. */
  organicGrowth: number;
  /** Total marketing budget spent across the whole horizon, in dollars. */
  budget: number;
  /** Relative spend weight in month 1 (shapes the front of the curve). */
  budgetDistEarly: number;
  /** Share of spend in the final month. Complements budgetDistEarly to
      total 100% (both stored as 0..1). */
  budgetDistLate: number;
  /** Share of newly-acquired users who return the following month. New
      users churn far harder than the established base, so they get their
      own rate. */
  newUserRetention: number;
  /** Monthly churn of the established (already-retained) active base. */
  mauChurn: number;
}

// DAU/MAU is a fixed modelling assumption, not a user lever — DAU is
// surfaced as a result (averages on the dials + the graph tooltip).
export const DAU_MAU_RATIO = 0.4;

export const GTM_DEFAULTS: GtmAssumptions = {
  cpa: 12,
  organicGrowth: 0.18,
  budget: 250_000,
  budgetDistEarly: 0.2,
  budgetDistLate: 0.8,
  newUserRetention: 0.35,
  mauChurn: 0.04,
};

// v4: churn split into new-user retention + established-base churn for a
// more accurate cohort model — bump so stale single-churn blobs don't load.
export const GTM_STORAGE_KEY = 'catalog:gtm:assumptions:v4';

export function readGtmStored(): GtmAssumptions {
  if (typeof window === 'undefined') return GTM_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(GTM_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...GTM_DEFAULTS, ...parsed };
    }
    return GTM_DEFAULTS;
  } catch {
    return GTM_DEFAULTS;
  }
}

export interface GtmMonth {
  monthIndex: number;
  /** Marketing spend allocated to this month. */
  spend: number;
  /** New users bought with paid spend this month (spend ÷ CPA). */
  paidAdds: number;
  /** New users that joined organically this month (% of prior base). */
  organicAdds: number;
  /** paidAdds + organicAdds. */
  newUsers: number;
  /** Active users lost to churn this month. */
  churned: number;
  /** Retained active base at month end (= MAU). */
  cumulativeUsers: number;
  /** Daily active users this month — MAU × DAU/MAU ratio. */
  dau: number;
  /** Cumulative spend ÷ all users ever acquired, at this point in time. */
  blendedCacToDate: number;
}

// Per-month spend weights interpolated linearly from the early weight
// (month 0) to the late weight (final month), then normalised so the
// whole curve sums back to `budget`. Lets an admin front- or back-load
// the spend without ever overshooting the total budget.
function spendWeights(a: GtmAssumptions): number[] {
  const last = Math.max(1, MONTHS - 1);
  const raw: number[] = [];
  for (let i = 0; i < MONTHS; i++) {
    const t = i / last;
    raw.push(Math.max(0, a.budgetDistEarly + (a.budgetDistLate - a.budgetDistEarly) * t));
  }
  const sum = raw.reduce((acc, w) => acc + w, 0) || 1;
  return raw.map(w => w / sum);
}

export function buildGtmSeries(a: GtmAssumptions): GtmMonth[] {
  const weights = spendWeights(a);
  const out: GtmMonth[] = [];
  // `established` is the retained base carried into each month; new users
  // this month are active too but only `newUserRetention` of them survive
  // into the established base next month. `everAcquired` is the gross count
  // (paid + organic) used for blended CAC so churn can't flatter it.
  let established = 0;
  let everAcquired = 0;
  let cumulativeSpend = 0;
  const cpa = a.cpa > 0 ? a.cpa : 1;
  const mauChurn = Math.min(1, Math.max(0, a.mauChurn));
  const newRet = Math.min(1, Math.max(0, a.newUserRetention));

  for (let i = 0; i < MONTHS; i++) {
    const spend = a.budget * weights[i];
    const paidAdds = spend / cpa;
    // Organic is word-of-mouth from the established base.
    const organicAdds = established * a.organicGrowth;
    const newUsers = paidAdds + organicAdds;
    // Everyone is active this month (the MAU); churn applies on the way
    // into next month.
    const activeMAU = established + newUsers;
    const churnedEstablished = established * mauChurn;
    const churnedNew = newUsers * (1 - newRet);
    const churned = churnedEstablished + churnedNew;
    established = Math.max(0, established - churnedEstablished + newUsers * newRet);
    everAcquired += newUsers;
    cumulativeSpend += spend;
    out.push({
      monthIndex: i,
      spend,
      paidAdds,
      organicAdds,
      newUsers,
      churned,
      cumulativeUsers: activeMAU,
      dau: activeMAU * DAU_MAU_RATIO,
      blendedCacToDate: everAcquired > 0 ? cumulativeSpend / everAcquired : 0,
    });
  }
  return out;
}

export interface GtmSummary {
  totalUsers: number;
  totalSpend: number;
  totalPaid: number;
  totalOrganic: number;
  organicShare: number;
  blendedCac: number;
  /** How many times cheaper the blended CAC is than the raw paid CPA. */
  cacEfficiency: number;
  peakMonthlyAdds: number;
  exitMonthlyAdds: number;
  /** Mean monthly active users across the horizon (a result, not a lever). */
  avgMau: number;
  /** Mean daily active users across the horizon. */
  avgDau: number;
}

export function summarizeGtm(series: GtmMonth[], a: GtmAssumptions): GtmSummary {
  const totalPaid = series.reduce((acc, s) => acc + s.paidAdds, 0);
  const totalOrganic = series.reduce((acc, s) => acc + s.organicAdds, 0);
  const totalUsers = totalPaid + totalOrganic;
  const totalSpend = series.reduce((acc, s) => acc + s.spend, 0);
  const blendedCac = totalUsers > 0 ? totalSpend / totalUsers : 0;
  const peakMonthlyAdds = series.reduce((acc, s) => Math.max(acc, s.newUsers), 0);
  const exitMonthlyAdds = series[series.length - 1]?.newUsers ?? 0;
  const n = series.length || 1;
  const avgMau = series.reduce((acc, s) => acc + s.cumulativeUsers, 0) / n;
  const avgDau = series.reduce((acc, s) => acc + s.dau, 0) / n;
  return {
    totalUsers,
    totalSpend,
    totalPaid,
    totalOrganic,
    organicShare: totalUsers > 0 ? totalOrganic / totalUsers : 0,
    blendedCac,
    cacEfficiency: blendedCac > 0 ? a.cpa / blendedCac : 0,
    peakMonthlyAdds,
    exitMonthlyAdds,
    avgMau,
    avgDau,
  };
}
