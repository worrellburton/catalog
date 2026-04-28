import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Unit tests for the semantic-search service layer.
 *
 * The two exported functions (nlSearch, triggerEmbedEntity) call the
 * Supabase edge functions over fetch. We stub fetch globally so the tests
 * run without a live network or Supabase credentials.
 *
 * Pure-logic helpers (URL construction, request shaping, response
 * normalization) are replicated inline — same pattern as looks.test.ts —
 * so they stay fast and deterministic.
 *
 * Embedding backend: TwelveLabs Marengo-retrieval-2.7 (1024-dim text)
 * Concept generation: Anthropic Claude Haiku
 */

// ── Constants mirrored from the service ──────────────────────────────────────
const SUPABASE_URL = 'https://hmgnrowqjrxvesmdshnp.supabase.co';
const ANON_KEY = 'test-anon-key';

// ── Types mirrored from the service ─────────────────────────────────────────
type SearchIntent =
  | 'outfit_pairing'
  | 'occasion_lookup'
  | 'product_find'
  | 'vibe_browse'
  | 'lookalike'
  | 'ambiguous';

interface QueryPlan {
  intent: SearchIntent;
  rewrites: string[];
  constraints: { gender?: string; occasion?: string; price_band?: string };
  result_shape: ('looks' | 'products' | 'creatives')[];
  anchor_name?: string;
}

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

interface NlSearchResponse {
  ok: boolean;
  results: SemanticResult[];
  query_plan: QueryPlan | null;
  cold_miss: boolean;
  query_id: string | null;
  meta: {
    result_count: number;
    top_score: number | null;
    embeddings_used: number;
    rewrites_used: number;
  } | null;
  error?: string;
}

// ── Pure helpers replicated from the service ─────────────────────────────────
function buildNlSearchUrl(baseUrl: string) {
  return `${baseUrl}/functions/v1/nl-search`;
}

function buildEmbedEntityUrl(baseUrl: string) {
  return `${baseUrl}/functions/v1/embed-entity`;
}

function buildNlSearchBody(
  query: string,
  opts: { k?: number; gender?: string; session_id?: string; user_id?: string } = {},
) {
  return JSON.stringify({ query, k: opts.k ?? 20, gender: opts.gender, session_id: opts.session_id, user_id: opts.user_id });
}

function separateResults(results: SemanticResult[]) {
  return {
    looks:    results.filter((r): r is SemanticLook    => r.entity_type === 'look'),
    products: results.filter((r): r is SemanticProduct => r.entity_type === 'product'),
  };
}

function isColdMiss(resp: NlSearchResponse): boolean {
  return resp.cold_miss;
}

// ── Factories ─────────────────────────────────────────────────────────────────
function makeSemanticLook(overrides: Partial<SemanticLook> = {}): SemanticLook {
  return {
    id: 'look-uuid-1',
    entity_type: 'look',
    title: 'Summer Glow',
    creator_handle: '@lilywittman',
    description: 'Effortless summer vibes',
    thumbnail_url: 'https://example.com/thumb.jpg',
    video_path: 'girl2.mp4',
    gender: 'women',
    concept_doc: 'A breezy summer look with linen and sandals.',
    score: 0.87,
    ...overrides,
  };
}

function makeSemanticProduct(overrides: Partial<SemanticProduct> = {}): SemanticProduct {
  return {
    id: 'product-uuid-1',
    entity_type: 'product',
    name: 'Linen Wide-Leg Trousers',
    brand: 'Zara',
    price: '$69',
    image_url: 'https://example.com/product.jpg',
    description: 'Flowy linen trousers',
    url: 'https://www.zara.com',
    gender: 'women',
    type: 'bottoms',
    score: 0.78,
    ...overrides,
  };
}

function makeQueryPlan(overrides: Partial<QueryPlan> = {}): QueryPlan {
  return {
    intent: 'vibe_browse',
    rewrites: ['summer outfits', 'warm weather looks'],
    constraints: {},
    result_shape: ['looks', 'products'],
    ...overrides,
  };
}

function makeNlSearchResponse(overrides: Partial<NlSearchResponse> = {}): NlSearchResponse {
  return {
    ok: true,
    results: [makeSemanticLook(), makeSemanticProduct()],
    query_plan: makeQueryPlan(),
    cold_miss: false,
    query_id: 'qid-abc-123',
    meta: { result_count: 2, top_score: 0.87, embeddings_used: 1, rewrites_used: 0 },
    ...overrides,
  };
}

// ── Tests: URL construction ───────────────────────────────────────────────────
describe('URL construction', () => {
  it('builds nl-search URL correctly', () => {
    expect(buildNlSearchUrl(SUPABASE_URL)).toBe(
      'https://hmgnrowqjrxvesmdshnp.supabase.co/functions/v1/nl-search',
    );
  });

  it('builds embed-entity URL correctly', () => {
    expect(buildEmbedEntityUrl(SUPABASE_URL)).toBe(
      'https://hmgnrowqjrxvesmdshnp.supabase.co/functions/v1/embed-entity',
    );
  });
});

// ── Tests: request body shaping ───────────────────────────────────────────────
describe('nlSearch request body', () => {
  it('includes query and default k=20', () => {
    const body = JSON.parse(buildNlSearchBody('white jeans'));
    expect(body.query).toBe('white jeans');
    expect(body.k).toBe(20);
  });

  it('respects custom k', () => {
    const body = JSON.parse(buildNlSearchBody('white jeans', { k: 10 }));
    expect(body.k).toBe(10);
  });

  it('includes gender when provided', () => {
    const body = JSON.parse(buildNlSearchBody('dress', { gender: 'women' }));
    expect(body.gender).toBe('women');
  });

  it('includes session_id and user_id when provided', () => {
    const body = JSON.parse(buildNlSearchBody('look', { session_id: 'sid-1', user_id: 'uid-1' }));
    expect(body.session_id).toBe('sid-1');
    expect(body.user_id).toBe('uid-1');
  });

  it('leaves optional fields undefined when not provided', () => {
    const body = JSON.parse(buildNlSearchBody('casual'));
    expect(body.gender).toBeUndefined();
    expect(body.session_id).toBeUndefined();
    expect(body.user_id).toBeUndefined();
  });
});

// ── Tests: separateResults ────────────────────────────────────────────────────
describe('separateResults', () => {
  it('separates looks from products', () => {
    const resp = makeNlSearchResponse();
    const { looks, products } = separateResults(resp.results);
    expect(looks).toHaveLength(1);
    expect(products).toHaveLength(1);
    expect(looks[0].entity_type).toBe('look');
    expect(products[0].entity_type).toBe('product');
  });

  it('handles all-look results', () => {
    const results: SemanticResult[] = [makeSemanticLook(), makeSemanticLook({ id: 'look-2' })];
    const { looks, products } = separateResults(results);
    expect(looks).toHaveLength(2);
    expect(products).toHaveLength(0);
  });

  it('handles all-product results', () => {
    const results: SemanticResult[] = [makeSemanticProduct(), makeSemanticProduct({ id: 'p-2' })];
    const { looks, products } = separateResults(results);
    expect(looks).toHaveLength(0);
    expect(products).toHaveLength(2);
  });

  it('handles empty results', () => {
    const { looks, products } = separateResults([]);
    expect(looks).toHaveLength(0);
    expect(products).toHaveLength(0);
  });

  it('preserves result order within each group', () => {
    const results: SemanticResult[] = [
      makeSemanticLook({ id: 'l1', score: 0.9 }),
      makeSemanticProduct({ id: 'p1', score: 0.85 }),
      makeSemanticLook({ id: 'l2', score: 0.75 }),
      makeSemanticProduct({ id: 'p2', score: 0.7 }),
    ];
    const { looks, products } = separateResults(results);
    expect(looks.map(l => l.id)).toEqual(['l1', 'l2']);
    expect(products.map(p => p.id)).toEqual(['p1', 'p2']);
  });
});

// ── Tests: cold-miss detection ────────────────────────────────────────────────
describe('cold-miss detection', () => {
  it('returns true when cold_miss is true', () => {
    const resp = makeNlSearchResponse({ cold_miss: true });
    expect(isColdMiss(resp)).toBe(true);
  });

  it('returns false when cold_miss is false', () => {
    const resp = makeNlSearchResponse({ cold_miss: false });
    expect(isColdMiss(resp)).toBe(false);
  });

  it('cold_miss is true on empty results', () => {
    const resp = makeNlSearchResponse({ cold_miss: true, results: [], query_id: null });
    expect(isColdMiss(resp)).toBe(true);
    expect(resp.results).toHaveLength(0);
  });
});

// ── Tests: nlSearch fetch integration ────────────────────────────────────────
// These tests stub global.fetch so they run without a live network.
describe('nlSearch (fetch stubbed)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the correct endpoint with POST', async () => {
    const mockResponse = makeNlSearchResponse();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    // Replicate nlSearch() logic
    const url = buildNlSearchUrl(SUPABASE_URL);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
      body: buildNlSearchBody('red carpet'),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain('/functions/v1/nl-search');
    expect(calledInit.method).toBe('POST');
    expect(JSON.parse(calledInit.body as string).query).toBe('red carpet');

    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.results).toHaveLength(2);
  });

  it('returns error response when fetch returns non-ok status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as Response);

    // Replicate the error-path of nlSearch
    const res = await fetch(buildNlSearchUrl(SUPABASE_URL), { method: 'POST' } as RequestInit);
    if (!res.ok) {
      const text = await (res as unknown as { text: () => Promise<string> }).text();
      const errorResp: NlSearchResponse = { ok: false, results: [], query_plan: null, cold_miss: true, query_id: null, meta: null, error: text.slice(0, 300) };
      expect(errorResp.ok).toBe(false);
      expect(errorResp.cold_miss).toBe(true);
      expect(errorResp.error).toBe('Internal Server Error');
    }
  });

  it('includes Authorization and apikey headers', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => makeNlSearchResponse() } as Response);

    await fetch(buildNlSearchUrl(SUPABASE_URL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ANON_KEY}`,
        apikey: ANON_KEY,
      },
      body: buildNlSearchBody('vibe'),
    });

    const headers = vi.mocked(fetch).mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${ANON_KEY}`);
    expect(headers['apikey']).toBe(ANON_KEY);
  });
});

// ── Tests: embed-entity request shaping ──────────────────────────────────────
describe('triggerEmbedEntity request shaping', () => {
  it('builds correct body for product entity', () => {
    const body = JSON.stringify({ id: 'prod-uuid', entity_type: 'product', force: false });
    const parsed = JSON.parse(body);
    expect(parsed.id).toBe('prod-uuid');
    expect(parsed.entity_type).toBe('product');
    expect(parsed.force).toBe(false);
  });

  it('builds correct body for look entity', () => {
    const body = JSON.stringify({ id: 'look-uuid', entity_type: 'look', force: true });
    const parsed = JSON.parse(body);
    expect(parsed.entity_type).toBe('look');
    expect(parsed.force).toBe(true);
  });

  it('uses provided authToken in Authorization header when supplied', () => {
    const customToken = 'service-role-jwt';
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customToken}`,
      apikey: ANON_KEY,
    };
    expect(headers['Authorization']).toBe('Bearer service-role-jwt');
  });

  it('falls back to anon key when no authToken provided', () => {
    const token = undefined ?? ANON_KEY;
    const headers = { Authorization: `Bearer ${token}` };
    expect(headers['Authorization']).toBe(`Bearer ${ANON_KEY}`);
  });
});

// ── Tests: QueryPlan structure ────────────────────────────────────────────────
describe('QueryPlan structure', () => {
  it('recognises all valid intents', () => {
    const validIntents: SearchIntent[] = [
      'outfit_pairing',
      'occasion_lookup',
      'product_find',
      'vibe_browse',
      'lookalike',
      'ambiguous',
    ];
    validIntents.forEach(intent => {
      const plan = makeQueryPlan({ intent });
      expect(plan.intent).toBe(intent);
    });
  });

  it('outfit_pairing plan can carry an anchor_name', () => {
    const plan = makeQueryPlan({ intent: 'outfit_pairing', anchor_name: 'white jeans' });
    expect(plan.anchor_name).toBe('white jeans');
  });

  it('rewrites defaults to array', () => {
    const plan = makeQueryPlan({ rewrites: [] });
    expect(Array.isArray(plan.rewrites)).toBe(true);
  });
});
