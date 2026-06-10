// Monthly OpEx builder model. A list of line items (employees + chart-of-
// accounts expenses) that each run over a span of the 16-month horizon and
// can ramp up or down month over month. buildOpexSchedule turns them into a
// per-month total that the financial model's cash flow runs on; the model's
// single "Monthly OpEx" field then just shows the average.

import { MONTHS } from './projections';

export type OpexCategory = 'payroll' | 'software' | 'marketing' | 'office' | 'other';

export const OPEX_CATEGORIES: { id: OpexCategory; label: string }[] = [
  { id: 'payroll', label: 'Payroll' },
  { id: 'software', label: 'Software' },
  { id: 'marketing', label: 'Marketing ops' },
  { id: 'office', label: 'Office & ops' },
  { id: 'other', label: 'Other' },
];

export const OPEX_CATEGORY_COLORS: Record<OpexCategory, string> = {
  payroll: '#6366f1',
  software: '#10b981',
  marketing: '#f59e0b',
  office: '#14b8a6',
  other: '#94a3b8',
};

export interface OpexItem {
  id: string;
  name: string;
  category: OpexCategory;
  /** Monthly cost in dollars in the item's first active month. Ignored when
   *  the item is MAU-variable (perMau > 0) — kept as the fixed fallback. */
  amount: number;
  /** First active month, 0-based inclusive. */
  startMonth: number;
  /** Last active month, 0-based inclusive (MONTHS-1 = runs to the end). */
  endMonth: number;
  /** Month-over-month change while active (decimal; negative ramps down).
   *  Ignored when the item is MAU-variable. */
  growth: number;
  /** When > 0, this line is VARIABLE: its monthly cost = perMau × that
   *  month's MAU (so servers / AI tokens scale with the user base) instead
   *  of the fixed amount/growth. $ per MAU per month. */
  perMau?: number;
}

export const OPEX_STORAGE_KEY = 'catalog:opex:v1';

// Sentinel endMonth meaning "no end / runs as long as the horizon". Past
// the last index; the schedule builders clamp it to MONTHS-1.
export const CONTINUOUS_END = MONTHS;
export const isContinuous = (endMonth: number) => endMonth >= MONTHS;

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function defaultOpexItems(): OpexItem[] {
  return [
    { id: uid(), name: 'Founders',       category: 'payroll',  amount: 24000, startMonth: 0, endMonth: CONTINUOUS_END, growth: 0 },
    { id: uid(), name: 'Engineering',    category: 'payroll',  amount: 20000, startMonth: 0, endMonth: CONTINUOUS_END, growth: 0.04 },
    { id: uid(), name: 'Software & SaaS', category: 'software', amount: 6000,  startMonth: 0, endMonth: CONTINUOUS_END, growth: 0.02 },
    { id: uid(), name: 'Office & ops',   category: 'office',   amount: 5000,  startMonth: 0, endMonth: CONTINUOUS_END, growth: 0.01 },
    // Variable infra — scale with the user base (see perMau). Servers cover
    // hosting + DB + CDN egress; AI tokens cover generation + embeddings +
    // Claude reasoning. amount is just the fixed fallback if perMau is cleared.
    { id: uid(), name: 'Servers & infrastructure', category: 'software', amount: 1500, startMonth: 0, endMonth: CONTINUOUS_END, growth: 0, perMau: 0.06 },
    { id: uid(), name: 'AI tokens & generation',   category: 'software', amount: 2500, startMonth: 0, endMonth: CONTINUOUS_END, growth: 0, perMau: 0.10 },
  ];
}

/** Cost of one OpEx line in month `m` (0-based). MAU-variable lines
 *  (perMau > 0) cost perMau × that month's MAU; everything else is the
 *  fixed amount compounded by growth. Returns 0 when the line is inactive. */
export function opexItemMonthly(it: OpexItem, m: number, mau?: number[]): number {
  const s = Math.max(0, Math.min(MONTHS - 1, Math.round(it.startMonth)));
  const e = Math.max(s, Math.min(MONTHS - 1, Math.round(it.endMonth)));
  if (m < s || m > e) return 0;
  if (it.perMau && it.perMau > 0) return it.perMau * (mau?.[m] ?? 0);
  return it.amount * Math.pow(1 + it.growth, m - s);
}

/** Per-month total OpEx across all line items, length MONTHS. Pass the MAU
 *  series so MAU-variable lines (perMau) cost perMau × MAU each month. */
export function buildOpexSchedule(items: OpexItem[], mau?: number[]): number[] {
  const out = new Array(MONTHS).fill(0);
  for (const it of items) {
    for (let m = 0; m < MONTHS; m++) out[m] += opexItemMonthly(it, m, mau);
  }
  return out;
}

/** Per-month totals split by category, for a stacked view. */
export function buildOpexByCategory(items: OpexItem[], mau?: number[]): Record<OpexCategory, number[]> {
  const out = {} as Record<OpexCategory, number[]>;
  for (const c of OPEX_CATEGORIES) out[c.id] = new Array(MONTHS).fill(0);
  for (const it of items) {
    for (let m = 0; m < MONTHS; m++) out[it.category][m] += opexItemMonthly(it, m, mau);
  }
  return out;
}

export function opexAverage(schedule: number[]): number {
  return schedule.length ? schedule.reduce((a, b) => a + b, 0) / schedule.length : 0;
}

export function opexTotal(schedule: number[]): number {
  return schedule.reduce((a, b) => a + b, 0);
}

// ── Payroll ─────────────────────────────────────────────────────
// People as their own line items: headcount × comp (annual or monthly),
// active over a span. Rolls into the 'payroll' OpEx category.

export type EmploymentType = 'employee' | 'contractor';

export interface PayrollItem {
  id: string;
  role: string;
  type: EmploymentType;
  /** Number of people in this role. */
  count: number;
  /** Whether `comp` is an annual or a monthly figure (per person). */
  basis: 'annual' | 'monthly';
  /** Compensation per person, in the chosen basis. */
  comp: number;
  startMonth: number;
  endMonth: number;
}

export const PAYROLL_STORAGE_KEY = 'catalog:payroll:v1';

// Start empty so it never double-counts payroll already entered as OpEx
// line items — admins add their team here, then drop those OpEx lines.
export function defaultPayrollItems(): PayrollItem[] {
  return [];
}

/** Monthly cost of one person in this role. */
export function payrollMonthlyPerPerson(p: PayrollItem): number {
  return p.basis === 'annual' ? p.comp / 12 : p.comp;
}

/** Monthly cost of the whole role (all people). */
export function payrollMonthly(p: PayrollItem): number {
  return payrollMonthlyPerPerson(p) * (p.count || 0);
}

export function buildPayrollSchedule(items: PayrollItem[]): number[] {
  const out = new Array(MONTHS).fill(0);
  for (const p of items) {
    const s = Math.max(0, Math.min(MONTHS - 1, Math.round(p.startMonth)));
    const e = Math.max(s, Math.min(MONTHS - 1, Math.round(p.endMonth)));
    const monthly = payrollMonthly(p);
    for (let m = s; m <= e; m++) out[m] += monthly;
  }
  return out;
}

/** Combined per-month OpEx: expense line items + payroll. Pass the MAU
 *  series so MAU-variable expense lines scale with the user base. */
export function buildCombinedSchedule(items: OpexItem[], payroll: PayrollItem[], mau?: number[]): number[] {
  const a = buildOpexSchedule(items, mau);
  const b = buildPayrollSchedule(payroll);
  return a.map((v, i) => v + b[i]);
}

/** Combined per-month totals by category (payroll folded into 'payroll'). */
export function buildCombinedByCategory(items: OpexItem[], payroll: PayrollItem[], mau?: number[]): Record<OpexCategory, number[]> {
  const byCat = buildOpexByCategory(items, mau);
  const pay = buildPayrollSchedule(payroll);
  for (let m = 0; m < MONTHS; m++) byCat.payroll[m] += pay[m];
  return byCat;
}
