import { describe, it, expect } from 'vitest';
import { composeRenderedCreatives, type ComposeRenderedArgs } from './feed-compose';
import type { ProductAd } from '~/services/product-creative';
import type { UserAffinity } from '~/services/user-affinity';

// Minimal ProductAd factory — only the fields composeRenderedCreatives reads.
function ad(id: string, productId: string, name = id): ProductAd {
  return {
    id,
    product_id: productId,
    product: { id: productId, name },
  } as unknown as ProductAd;
}

const NO_AFFINITY: UserAffinity = { entries: [], topTypes: [], dominant: null, total: 0 };

function baseArgs(overrides: Partial<ComposeRenderedArgs>): ComposeRenderedArgs {
  return {
    committedQuery: '',
    brandMatch: [],
    tagMatch: [],
    semanticOrdered: [],
    seenKeys: new Set<string>(),
    affinity: NO_AFFINITY,
    personalizedOrder: null,
    ...overrides,
  };
}

const ids = (rows: ProductAd[]) => rows.map(r => r.id);

describe('composeRenderedCreatives', () => {
  // The regression that motivated this module: a color/category search
  // ("black shoes") returned white sneakers because the query-agnostic
  // personalized order floated globally-popular products to the front,
  // overriding the server's color-aware ranking.
  it('returns the semantic ranker order VERBATIM for an active search, ignoring personalization', () => {
    const semanticOrdered = [
      ad('black-1', 'p-black-1'),  // search_products ranked these first (color_tier)
      ad('black-2', 'p-black-2'),
      ad('white-1', 'p-white-1'),  // popular whites rank below for "black shoes"
      ad('white-2', 'p-white-2'),
    ];
    const out = composeRenderedCreatives(baseArgs({
      committedQuery: 'black shoes',
      semanticOrdered,
      // The Automatic Editor would float the whites to the front on the home feed.
      personalizedOrder: ['p-white-1', 'p-white-2'],
      // A strong affinity + a fully-seen set would also reorder on the home feed.
      affinity: { entries: [{ type: 'Sneakers', weight: 10 }], topTypes: ['Sneakers'], dominant: 'Sneakers', total: 99 } as unknown as UserAffinity,
      seenKeys: new Set(['product:p-black-1', 'product:p-black-2']),
    }));
    // Order must be untouched — black still leads.
    expect(ids(out)).toEqual(['black-1', 'black-2', 'white-1', 'white-2']);
  });

  it('applies the personalized order on the home feed (no active query)', () => {
    const semanticOrdered = [
      ad('a', 'p-a'),
      ad('b', 'p-b'),
      ad('c', 'p-c'),
    ];
    const out = composeRenderedCreatives(baseArgs({
      committedQuery: '',
      semanticOrdered,
      personalizedOrder: ['p-c', 'p-a'], // float c then a to the front
    }));
    expect(ids(out)).toEqual(['c', 'a', 'b']);
  });

  it('short queries (< 3 chars) are treated as the home feed, not a search', () => {
    const semanticOrdered = [ad('a', 'p-a'), ad('b', 'p-b')];
    const out = composeRenderedCreatives(baseArgs({
      committedQuery: 'hi',
      semanticOrdered,
      personalizedOrder: ['p-b'],
    }));
    expect(ids(out)).toEqual(['b', 'a']); // personalization applied
  });

  it('brand fast-path takes priority and dedups by product_id', () => {
    const out = composeRenderedCreatives(baseArgs({
      committedQuery: 'nike',
      brandMatch: [
        ad('c1', 'p-1'),
        ad('c2', 'p-1'), // same product, different creative → dropped
        ad('c3', 'p-2'),
      ],
      semanticOrdered: [ad('s1', 'p-9')],
    }));
    expect(ids(out)).toEqual(['c1', 'c3']);
  });

  it('tier-1 tag match returns those exclusively, deduped by id', () => {
    const out = composeRenderedCreatives(baseArgs({
      committedQuery: 'shoes',
      tagMatch: [ad('t1', 'p-1'), ad('t1', 'p-1'), ad('t2', 'p-2')],
      semanticOrdered: [ad('s1', 'p-9')],
    }));
    expect(ids(out)).toEqual(['t1', 't2']);
  });

  it('active search with no results returns empty (does NOT fall back to home feed)', () => {
    const out = composeRenderedCreatives(baseArgs({
      committedQuery: 'black shoes',
      semanticOrdered: [],
      personalizedOrder: ['p-a', 'p-b'],
    }));
    expect(out).toEqual([]);
  });
});
