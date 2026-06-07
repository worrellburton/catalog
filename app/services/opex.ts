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
  /** Monthly cost in dollars in the item's first active month. */
  amount: number;
  /** First active month, 0-based inclusive. */
  startMonth: number;
  /** Last active month, 0-based inclusive (MONTHS-1 = runs to the end). */
  endMonth: number;
  /** Month-over-month change while active (decimal; negative ramps down). */
  growth: number;
}

export const OPEX_STORAGE_KEY = 'catalog:opex:v1';

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function defaultOpexItems(): OpexItem[] {
  return [
    { id: uid(), name: 'Founders',       category: 'payroll',  amount: 24000, startMonth: 0, endMonth: MONTHS - 1, growth: 0 },
    { id: uid(), name: 'Engineering',    category: 'payroll',  amount: 20000, startMonth: 0, endMonth: MONTHS - 1, growth: 0.04 },
    { id: uid(), name: 'Software & SaaS', category: 'software', amount: 6000,  startMonth: 0, endMonth: MONTHS - 1, growth: 0.02 },
    { id: uid(), name: 'Office & ops',   category: 'office',   amount: 5000,  startMonth: 0, endMonth: MONTHS - 1, growth: 0.01 },
  ];
}

/** Per-month total OpEx across all line items, length MONTHS. */
export function buildOpexSchedule(items: OpexItem[]): number[] {
  const out = new Array(MONTHS).fill(0);
  for (const it of items) {
    const s = Math.max(0, Math.min(MONTHS - 1, Math.round(it.startMonth)));
    const e = Math.max(s, Math.min(MONTHS - 1, Math.round(it.endMonth)));
    for (let m = s; m <= e; m++) {
      out[m] += it.amount * Math.pow(1 + it.growth, m - s);
    }
  }
  return out;
}

/** Per-month totals split by category, for a stacked view. */
export function buildOpexByCategory(items: OpexItem[]): Record<OpexCategory, number[]> {
  const out = {} as Record<OpexCategory, number[]>;
  for (const c of OPEX_CATEGORIES) out[c.id] = new Array(MONTHS).fill(0);
  for (const it of items) {
    const s = Math.max(0, Math.min(MONTHS - 1, Math.round(it.startMonth)));
    const e = Math.max(s, Math.min(MONTHS - 1, Math.round(it.endMonth)));
    for (let m = s; m <= e; m++) {
      out[it.category][m] += it.amount * Math.pow(1 + it.growth, m - s);
    }
  }
  return out;
}

export function opexAverage(schedule: number[]): number {
  return schedule.length ? schedule.reduce((a, b) => a + b, 0) / schedule.length : 0;
}

export function opexTotal(schedule: number[]): number {
  return schedule.reduce((a, b) => a + b, 0);
}
