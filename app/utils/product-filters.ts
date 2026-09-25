// Faceted filtering for the admin Data → Products table. Each facet (status,
// health, audience, bucket, health issue) filters on its own, and every facet's
// counts are taken with all the OTHER facets applied, so the number on a tab
// is exactly what clicking it shows. Pure so it's unit-tested.

// imports
import type { HealthCheck, HealthLevel } from '~/utils/product-health';

// types
export type ProductStatus = 'all' | 'active' | 'inactive';
export type ProductBucket = 'no-creative' | 'untagged' | 'affiliate' | 'no-affiliate' | 'automatic' | 'seeded' | 'soft-deleted';
export type HealthFilter = 'all' | HealthLevel;
export type HealthIssue = HealthCheck['key'];
export type GenderFilter = 'all' | 'male' | 'female' | 'unisex';
export type DateFilterMode = 'all' | 'week' | 'month' | 'today' | 'before' | 'on' | 'after' | 'between';

export interface ProductFilterState {
  status: ProductStatus;
  health: HealthFilter;
  gender: GenderFilter;
  bucket: ProductBucket | null;
  issue: HealthIssue | null;
}

/** The per-row facts the facets read, precomputed once per row. */
export interface FilterRow {
  isActive: boolean;
  deleted: boolean;
  hasCreative: boolean;
  gender: 'male' | 'female' | 'unisex' | null;
  monetized: boolean;
  automatic: boolean;
  seeded: boolean;
  healthLevel: HealthLevel;
  /** Health checks that aren't ok. */
  issues: ReadonlySet<HealthIssue>;
}

export interface FacetCounts {
  status: Record<ProductStatus, number>;
  health: Record<HealthFilter, number>;
  gender: Record<GenderFilter, number>;
  bucket: Record<ProductBucket, number>;
  issue: Record<HealthIssue, number>;
}

type Facet = keyof ProductFilterState;

// constants
export const PRODUCT_STATUSES: ProductStatus[] = ['all', 'active', 'inactive'];
export const HEALTH_FILTERS: HealthFilter[] = ['all', 'ok', 'warn', 'fail'];
export const GENDER_FILTERS: GenderFilter[] = ['all', 'female', 'male', 'unisex'];
export const PRODUCT_BUCKETS: ProductBucket[] = ['no-creative', 'untagged', 'affiliate', 'no-affiliate', 'automatic', 'seeded', 'soft-deleted'];
export const HEALTH_ISSUES: HealthIssue[] = ['media', 'identity', 'price', 'link'];

export const DEFAULT_PRODUCT_FILTERS: ProductFilterState = {
  status: 'active', health: 'all', gender: 'all', bucket: null, issue: null,
};

// main logic
function matchStatus(row: FilterRow, status: ProductStatus, bucket: ProductBucket | null): boolean {
  // The soft-delete bucket is its own world: only deleted rows, any status.
  if (bucket === 'soft-deleted') return row.deleted;
  if (row.deleted) return false;
  if (status === 'active') return row.isActive;
  if (status === 'inactive') return !row.isActive;
  return true;
}

function matchBucket(row: FilterRow, bucket: ProductBucket | null): boolean {
  switch (bucket) {
    case null: return true;
    case 'no-creative': return !row.hasCreative;
    case 'untagged': return row.gender == null;
    case 'affiliate': return row.monetized;
    case 'no-affiliate': return !row.monetized;
    case 'automatic': return row.automatic;
    case 'seeded': return row.seeded;
    case 'soft-deleted': return row.deleted;
  }
}

function matches(row: FilterRow, s: ProductFilterState, skip?: Facet): boolean {
  if (!matchStatus(row, skip === 'status' ? 'all' : s.status, skip === 'bucket' ? null : s.bucket)) return false;
  if (skip !== 'bucket' && !matchBucket(row, s.bucket)) return false;
  if (skip !== 'health' && s.health !== 'all' && row.healthLevel !== s.health) return false;
  if (skip !== 'gender' && s.gender !== 'all' && row.gender !== s.gender) return false;
  if (skip !== 'issue' && s.issue && !row.issues.has(s.issue)) return false;
  return true;
}

/** Does this row pass every active facet? */
export function matchesProductFilters(row: FilterRow, state: ProductFilterState): boolean {
  return matches(row, state);
}

/** Counts for every option of every facet, each with the other facets applied. */
export function productFacetCounts(rows: FilterRow[], state: ProductFilterState): FacetCounts {
  const counts: FacetCounts = {
    status: { all: 0, active: 0, inactive: 0 },
    health: { all: 0, ok: 0, warn: 0, fail: 0 },
    gender: { all: 0, male: 0, female: 0, unisex: 0 },
    bucket: { 'no-creative': 0, untagged: 0, affiliate: 0, 'no-affiliate': 0, automatic: 0, seeded: 0, 'soft-deleted': 0 },
    issue: { media: 0, identity: 0, price: 0, link: 0 },
  };
  for (const row of rows) {
    if (matches(row, state, 'status')) {
      if (!row.deleted || state.bucket === 'soft-deleted') {
        counts.status.all += 1;
        counts.status[row.isActive ? 'active' : 'inactive'] += 1;
      }
    }
    if (matches(row, state, 'health')) {
      counts.health.all += 1;
      counts.health[row.healthLevel] += 1;
    }
    if (matches(row, state, 'gender')) {
      counts.gender.all += 1;
      if (row.gender) counts.gender[row.gender] += 1;
    }
    if (matches(row, state, 'issue')) {
      for (const issue of row.issues) counts.issue[issue] += 1;
    }
    for (const bucket of PRODUCT_BUCKETS) {
      if (matches(row, { ...state, bucket }, undefined)) counts.bucket[bucket] += 1;
    }
  }
  return counts;
}

/** How many facets differ from the defaults (drives "Clear all"). */
export function activeFilterCount(state: ProductFilterState): number {
  return (Object.keys(DEFAULT_PRODUCT_FILTERS) as Facet[])
    .filter(k => state[k] !== DEFAULT_PRODUCT_FILTERS[k]).length;
}
