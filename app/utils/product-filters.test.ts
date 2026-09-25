import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRODUCT_FILTERS,
  activeFilterCount,
  matchesProductFilters,
  productFacetCounts,
  type FilterRow,
  type HealthIssue,
} from './product-filters';

function row(over: Partial<FilterRow> = {}): FilterRow {
  return {
    isActive: true,
    deleted: false,
    hasCreative: true,
    gender: 'female',
    monetized: true,
    automatic: false,
    seeded: false,
    healthLevel: 'ok',
    issues: new Set<HealthIssue>(),
    ...over,
  };
}

describe('product filters', () => {
  const rows = [
    row(),
    row({ healthLevel: 'fail', issues: new Set<HealthIssue>(['media', 'link']) }),
    row({ isActive: false, healthLevel: 'warn', gender: 'male', issues: new Set<HealthIssue>(['price']) }),
    row({ deleted: true }),
    row({ gender: null, hasCreative: false }),
  ];

  it('defaults to live, non-deleted rows', () => {
    expect(rows.filter(r => matchesProductFilters(r, DEFAULT_PRODUCT_FILTERS))).toHaveLength(3);
  });

  it('counts each facet with the other facets applied', () => {
    const c = productFacetCounts(rows, { ...DEFAULT_PRODUCT_FILTERS, health: 'fail' });
    // status counts ignore the status facet but keep health = fail
    expect(c.status).toEqual({ all: 1, active: 1, inactive: 0 });
    // health counts ignore health but keep status = active
    expect(c.health).toEqual({ all: 3, ok: 2, warn: 0, fail: 1 });
    expect(c.issue.media).toBe(1);
    expect(c.issue.price).toBe(0);
  });

  it('soft-delete bucket shows only deleted rows regardless of status', () => {
    const state = { ...DEFAULT_PRODUCT_FILTERS, bucket: 'soft-deleted' as const };
    expect(rows.filter(r => matchesProductFilters(r, state))).toHaveLength(1);
    expect(productFacetCounts(rows, DEFAULT_PRODUCT_FILTERS).bucket['soft-deleted']).toBe(1);
  });

  it('buckets and issues compose with status', () => {
    const c = productFacetCounts(rows, DEFAULT_PRODUCT_FILTERS);
    expect(c.bucket.untagged).toBe(1);
    expect(c.bucket['no-creative']).toBe(1);
    expect(matchesProductFilters(rows[2], { ...DEFAULT_PRODUCT_FILTERS, status: 'inactive', issue: 'price' })).toBe(true);
  });

  it('counts active facets', () => {
    expect(activeFilterCount(DEFAULT_PRODUCT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_PRODUCT_FILTERS, health: 'warn', gender: 'male' })).toBe(2);
  });
});
