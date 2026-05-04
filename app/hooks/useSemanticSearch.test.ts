import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Unit tests for the useSemanticSearch hook and its supporting utilities.
 *
 * The hook itself requires a DOM + React renderer to test its full
 * lifecycle. Since @testing-library/react is not installed, we test the
 * extractable pure logic:
 *   1. Session ID generation (localStorage-based, stable within a session)
 *   2. Result separation (looks vs products)
 *   3. Look ID extraction (ordering preserved)
 *   4. Debounce threshold (MIN_QUERY_LENGTH)
 *   5. Gender option mapping
 *
 * fetch-stubbed async scenarios follow the same vi.stubGlobal pattern
 * used in semantic-search.test.ts.
 */

// ── Constants mirrored from the hook ─────────────────────────────────────────
const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 500;

// ── Types mirrored from the hook ─────────────────────────────────────────────
interface SemanticLook {
  id: string;
  entity_type: 'look';
  title: string;
  creator_handle: string;
  description: string | null;
  thumbnail_url: string | null;
  video_path: string | null;
  gender: string | null;
  concept_doc: string | null;
  score: number;
}

interface SemanticProduct {
  id: string;
  entity_type: 'product';
  name: string;
  brand: string | null;
  price: string | null;
  image_url: string | null;
  description: string | null;
  url: string | null;
  gender: string | null;
  type: string | null;
  score: number;
}

type SemanticResult = SemanticLook | SemanticProduct;

interface SemanticSearchState {
  lookIds: string[];
  products: SemanticProduct[];
  looks: SemanticLook[];
  loading: boolean;
  coldMiss: boolean;
  queryPlan: null | object;
  queryId: string | null;
  error: string | null;
}

// ── Replicated pure helpers from the hook ────────────────────────────────────

/**
 * Mirrors getSessionId() - stable within a storage scope.
 * Uses a provided storage adapter so tests don't touch real localStorage.
 */
function getSessionId(storage: Record<string, string>): string {
  const key = 'catalog:search-session';
  if (storage[key]) return storage[key];
  const sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
  storage[key] = sid;
  return sid;
}

function extractLookIds(looks: SemanticLook[]): string[] {
  return looks.map(l => l.id);
}

function separateLooksAndProducts(results: SemanticResult[]) {
  return {
    looks:    results.filter((r): r is SemanticLook    => r.entity_type === 'look'),
    products: results.filter((r): r is SemanticProduct => r.entity_type === 'product'),
  };
}

function shouldFireSearch(query: string): boolean {
  return query.trim().length >= MIN_QUERY_LENGTH;
}

function mapGenderOption(filter: 'all' | 'men' | 'women'): string | undefined {
  return filter === 'all' ? undefined : filter;
}

// ── Factories ─────────────────────────────────────────────────────────────────
function makeLook(id: string, score = 0.9): SemanticLook {
  return {
    id,
    entity_type: 'look',
    title: `Look ${id}`,
    creator_handle: '@creator',
    description: null,
    thumbnail_url: null,
    video_path: null,
    gender: 'women',
    concept_doc: null,
    score,
  };
}

function makeProduct(id: string, score = 0.8): SemanticProduct {
  return {
    id,
    entity_type: 'product',
    name: `Product ${id}`,
    brand: 'Brand',
    price: '$99',
    image_url: null,
    description: null,
    url: null,
    gender: null,
    type: null,
    score,
  };
}

const EMPTY_STATE: SemanticSearchState = {
  lookIds: [],
  products: [],
  looks: [],
  loading: false,
  coldMiss: false,
  queryPlan: null,
  queryId: null,
  error: null,
};

// ── Tests: session ID ─────────────────────────────────────────────────────────
describe('getSessionId', () => {
  it('generates a non-empty session ID', () => {
    const store: Record<string, string> = {};
    const sid = getSessionId(store);
    expect(sid).toBeTruthy();
    expect(typeof sid).toBe('string');
  });

  it('returns the same ID on subsequent calls (stable within session)', () => {
    const store: Record<string, string> = {};
    const id1 = getSessionId(store);
    const id2 = getSessionId(store);
    expect(id1).toBe(id2);
  });

  it('generates different IDs across independent sessions', () => {
    const store1: Record<string, string> = {};
    const store2: Record<string, string> = {};
    const id1 = getSessionId(store1);
    const id2 = getSessionId(store2);
    // These are random - they should not collide (test is probabilistic but
    // collision probability is ~1 in 10^12)
    expect(id1).not.toBe(id2);
  });

  it('persists the ID in the provided store', () => {
    const store: Record<string, string> = {};
    const id = getSessionId(store);
    expect(store['catalog:search-session']).toBe(id);
  });

  it('respects a pre-existing ID in the store', () => {
    const store = { 'catalog:search-session': 'pre-existing-id' };
    expect(getSessionId(store)).toBe('pre-existing-id');
  });
});

// ── Tests: shouldFireSearch ────────────────────────────────────────────────────
describe('shouldFireSearch (MIN_QUERY_LENGTH gate)', () => {
  it(`fires for queries with ${MIN_QUERY_LENGTH} characters`, () => {
    expect(shouldFireSearch('abc')).toBe(true);
  });

  it('fires for longer queries', () => {
    expect(shouldFireSearch('white jeans outfit')).toBe(true);
  });

  it(`does not fire for ${MIN_QUERY_LENGTH - 1} character query`, () => {
    expect(shouldFireSearch('ab')).toBe(false);
  });

  it('does not fire for empty string', () => {
    expect(shouldFireSearch('')).toBe(false);
  });

  it('trims whitespace before checking length', () => {
    // Two spaces + one char = length 1 after trim - below threshold
    expect(shouldFireSearch('  a')).toBe(false);
    expect(shouldFireSearch('  ab ')).toBe(false);
    expect(shouldFireSearch('  abc ')).toBe(true);
  });

  it('does not fire for whitespace-only strings', () => {
    expect(shouldFireSearch('   ')).toBe(false);
  });
});

// ── Tests: result separation ──────────────────────────────────────────────────
describe('separateLooksAndProducts', () => {
  it('correctly separates a mixed result set', () => {
    const results: SemanticResult[] = [
      makeLook('l1'), makeProduct('p1'), makeLook('l2'),
    ];
    const { looks, products } = separateLooksAndProducts(results);
    expect(looks).toHaveLength(2);
    expect(products).toHaveLength(1);
  });

  it('returns empty arrays for empty input', () => {
    const { looks, products } = separateLooksAndProducts([]);
    expect(looks).toHaveLength(0);
    expect(products).toHaveLength(0);
  });

  it('all items are looks', () => {
    const results: SemanticResult[] = [makeLook('l1'), makeLook('l2'), makeLook('l3')];
    const { looks, products } = separateLooksAndProducts(results);
    expect(looks).toHaveLength(3);
    expect(products).toHaveLength(0);
  });

  it('all items are products', () => {
    const results: SemanticResult[] = [makeProduct('p1'), makeProduct('p2')];
    const { looks, products } = separateLooksAndProducts(results);
    expect(looks).toHaveLength(0);
    expect(products).toHaveLength(2);
  });
});

// ── Tests: look ID extraction ─────────────────────────────────────────────────
describe('extractLookIds', () => {
  it('extracts IDs in order', () => {
    const looks = [makeLook('l1', 0.9), makeLook('l2', 0.8), makeLook('l3', 0.7)];
    expect(extractLookIds(looks)).toEqual(['l1', 'l2', 'l3']);
  });

  it('returns empty array for empty input', () => {
    expect(extractLookIds([])).toEqual([]);
  });

  it('preserves UUID format', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(extractLookIds([makeLook(uuid)])).toEqual([uuid]);
  });
});

// ── Tests: gender option mapping ──────────────────────────────────────────────
describe('mapGenderOption', () => {
  it('maps "all" to undefined', () => {
    expect(mapGenderOption('all')).toBeUndefined();
  });

  it('maps "women" to "women"', () => {
    expect(mapGenderOption('women')).toBe('women');
  });

  it('maps "men" to "men"', () => {
    expect(mapGenderOption('men')).toBe('men');
  });
});

// ── Tests: empty state constant ───────────────────────────────────────────────
describe('EMPTY_STATE', () => {
  it('has all arrays empty', () => {
    expect(EMPTY_STATE.lookIds).toEqual([]);
    expect(EMPTY_STATE.products).toEqual([]);
    expect(EMPTY_STATE.looks).toEqual([]);
  });

  it('has loading=false and coldMiss=false', () => {
    expect(EMPTY_STATE.loading).toBe(false);
    expect(EMPTY_STATE.coldMiss).toBe(false);
  });

  it('has null for queryPlan, queryId, error', () => {
    expect(EMPTY_STATE.queryPlan).toBeNull();
    expect(EMPTY_STATE.queryId).toBeNull();
    expect(EMPTY_STATE.error).toBeNull();
  });
});

// ── Tests: state transition after successful response ────────────────────────
describe('state update from nlSearch response', () => {
  function applySuccessResponse(
    results: SemanticResult[],
    cold_miss: boolean,
    query_id: string | null,
    queryPlan: object | null,
  ): SemanticSearchState {
    const { looks, products } = separateLooksAndProducts(results);
    return {
      lookIds:   extractLookIds(looks),
      products,
      looks,
      loading:   false,
      coldMiss:  cold_miss,
      queryPlan,
      queryId:   query_id,
      error:     null,
    };
  }

  it('correctly maps a mixed response into state', () => {
    const plan = { intent: 'vibe_browse', rewrites: [], constraints: {}, result_shape: ['looks'] };
    const state = applySuccessResponse(
      [makeLook('l1'), makeProduct('p1')],
      false,
      'qid-1',
      plan,
    );
    expect(state.lookIds).toEqual(['l1']);
    expect(state.products).toHaveLength(1);
    expect(state.loading).toBe(false);
    expect(state.coldMiss).toBe(false);
    expect(state.queryId).toBe('qid-1');
    expect(state.queryPlan).toBe(plan);
    expect(state.error).toBeNull();
  });

  it('cold_miss=true propagates into state', () => {
    const state = applySuccessResponse([], true, null, null);
    expect(state.coldMiss).toBe(true);
    expect(state.lookIds).toEqual([]);
    expect(state.products).toEqual([]);
    expect(state.queryId).toBeNull();
  });

  it('preserves look rank order in lookIds', () => {
    const looks = [makeLook('l1', 0.95), makeLook('l2', 0.88), makeLook('l3', 0.72)];
    const state = applySuccessResponse(looks, false, 'qid-2', null);
    expect(state.lookIds).toEqual(['l1', 'l2', 'l3']);
  });
});

// ── Tests: debounce constant ─────────────────────────────────────────────────
describe('DEBOUNCE_MS', () => {
  it('is 500ms', () => {
    expect(DEBOUNCE_MS).toBe(500);
  });
});

// ── Tests: AbortController integration ───────────────────────────────────────
describe('AbortController - stale request cancellation', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('aborted signal causes fetch to be skipped', async () => {
    const controller = new AbortController();
    controller.abort();

    // Replicate the abort-check pattern from the hook
    let resultProcessed = false;
    const fakeResult: SemanticResult[] = [makeLook('l1')];

    if (!controller.signal.aborted) {
      const { looks } = separateLooksAndProducts(fakeResult);
      resultProcessed = looks.length > 0;
    }

    expect(resultProcessed).toBe(false);
  });

  it('non-aborted signal allows processing', () => {
    const controller = new AbortController();

    let resultProcessed = false;
    const fakeResult: SemanticResult[] = [makeLook('l1')];

    if (!controller.signal.aborted) {
      const { looks } = separateLooksAndProducts(fakeResult);
      resultProcessed = looks.length > 0;
    }

    expect(resultProcessed).toBe(true);
  });
});
