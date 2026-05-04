// nl-search — Natural-language search orchestrator (creative-first).
//
// Unified pipeline. Every query runs the same shape:
//
//   ┌──────────────────────────────────────────────────────────────────┐
//   │ 1. cache lookup: query_embeddings.{embedding, expansion}         │
//   │ 2. in parallel, fill any missing pieces:                         │
//   │      • OpenAI text-embedding-3-small  (1536-dim)                 │
//   │      • Claude Haiku query expansion   (intent + product types)   │
//   │      • TwelveLabs Marengo (text→video, vibe queries only, 600ms) │
//   │ 3. one SQL call: search_creatives_hybrid(embedding, query,       │
//   │       filter_types, filter_gender, exclude_ids)                  │
//   │ 4. (vibe only) RRF-fuse with the visual lane                     │
//   │ 5. dedupe by product_id, log, return                             │
//   └──────────────────────────────────────────────────────────────────┘
//
// Why Haiku instead of a static synonym map? "pants" should pull pants,
// shorts and leggings; "loafers" should NOT. Curating that mapping by hand
// in two languages (TS frontend + TS edge) doesn't scale and goes stale
// every time we add a category. Haiku decides per query against the
// canonical product.type list, and we cache the answer forever.
//
// Cache hit → ~80 ms total (one SQL call).
// Cache miss → ~max(haiku, embed)+SQL ≈ ~400 ms.
// Hard timeout on Haiku → falls back to the static analyzeQuery so the
// request never blocks waiting for an LLM.
//
// Required secrets:
//   ANTHROPIC_API_KEY   — Claude Haiku (query expansion + plan)
//   OPENAI_API_KEY      — text-embedding-3-small
//   TWELVELABS_API_KEY  — Marengo 3.0 (vibe lane, optional)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { analyzeQuery } from './query-analyzer.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

// Hard upper bounds on the parallel fill-ins. Anything slower falls back
// to the static analyzer / no visual lane so the request never stalls.
// Haiku typically responds in 800-1500ms; 600ms was timing out >90% of
// requests and writing degraded `intent=vibe` rows to the query cache,
// which then poisoned every subsequent request for the same query.
const HAIKU_TIMEOUT_MS      = 2500;
const TWELVELABS_TIMEOUT_MS = 600;

// Cache invalidation knobs. Bump either constant to expire all cached
// query_embeddings rows that were generated under the old version. The DB
// holds embedding_v / expansion_v columns alongside expires_at; rows are
// only treated as a hit when both versions match AND expires_at is in the
// future. Default TTL is 30 days from write.
const EMBED_V        = 1;
const EXPANSION_V    = 1;
// Daily cache refresh: keeps repeat searches under <1s but ensures users
// see freshly-ingested products without waiting 30 days for cache rollover.
const CACHE_TTL_DAYS = 1;

// When the creative pool returns < this many results, fan out to the
// products lane so we don't ship a near-empty grid back to the user.
const MIN_RESULTS_THRESHOLD = 8;
const MAX_PER_PRODUCT       = 2;

// Canonical product.type values are loaded from the product_types_canonical
// view at boot and refreshed every 5 minutes. The hard-coded list this
// replaced was fashion-only and silently dropped Haiku's correct picks for
// non-fashion categories (Fragrance, Hair Cream, Candle, …).
let CANONICAL_TYPES_CACHE: { types: string[]; loaded_at: number } | null = null;
const CANONICAL_TYPES_TTL_MS = 5 * 60 * 1000;

async function loadCanonicalTypes(admin: ReturnType<typeof createClient>): Promise<string[]> {
  const now = Date.now();
  if (CANONICAL_TYPES_CACHE && now - CANONICAL_TYPES_CACHE.loaded_at < CANONICAL_TYPES_TTL_MS) {
    return CANONICAL_TYPES_CACHE.types;
  }
  try {
    const { data, error } = await admin
      .from('product_types_canonical')
      .select('type');
    if (error) throw error;
    const types = (data ?? [])
      .map((r: Record<string, unknown>) => r.type)
      .filter((t: unknown): t is string => typeof t === 'string' && t.length > 0);
    if (types.length === 0) throw new Error('empty canonical types');
    CANONICAL_TYPES_CACHE = { types, loaded_at: now };
    return types;
  } catch (err) {
    console.warn('[nl-search] loadCanonicalTypes failed, using last cache or fallback:', err);
    return CANONICAL_TYPES_CACHE?.types ?? CANONICAL_TYPES_FALLBACK;
  }
}

// Last-resort fallback if the view query fails on a cold instance.
const CANONICAL_TYPES_FALLBACK: string[] = [
  'Top', 'Jacket', 'Pants', 'Shorts', 'Skirt', 'Dress', 'Coat',
  'Underwear', 'Activewear', 'Loungewear', 'Swimwear',
  'Sneakers', 'Boots', 'Sandals', 'Heels', 'Loafers', 'Flats', 'Mules',
  'Hat', 'Bag', 'Scarf', 'Socks',
  'Fragrance', 'Skincare', 'Book', 'Yoga',
];

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Intent = 'browse' | 'pairing' | 'vibe';

interface QueryExpansion {
  intent: Intent;
  /** Catalog types the user is browsing FOR. Empty when intent='vibe' or 'pairing'. */
  types: string[];
  /** When intent='pairing', the type of the anchor item (the X in "wear with X"). */
  anchor_type: string | null;
  /** When intent='pairing', the complementary types to surface (NOT the anchor). */
  pair_types: string[] | null;
  /** Free-form keywords stripped of category nouns — drives BM25 within-type ranking. */
  keywords: string;
}

interface CreativeRow {
  id: string;
  entity_type: 'creative';
  product_id: string;
  video_url: string | null;
  thumbnail_url: string | null;
  affiliate_url: string | null;
  duration_seconds: number | null;
  is_elite: boolean | null;
  product_name: string | null;
  product_brand: string | null;
  product_price: string | null;
  product_image_url: string | null;
  product_url: string | null;
  product_gender: string | null;
  product_type: string | null;
  concept_doc: string | null;
  concept_facets: Record<string, unknown> | null;
  rrf_score: number;
  dense_rank: number | null;
  bm25_rank:  number | null;
  type_match?: boolean | null;
}

type SearchResult = CreativeRow & { score: number };

// ── Claude Haiku: query expansion ────────────────────────────────────────────

async function expandQueryWithHaiku(query: string, anthropicKey: string, canonicalTypes: string[]): Promise<QueryExpansion> {
  const typeList = canonicalTypes.join(', ');
  const prompt = `You are a multi-category catalog search planner. The catalog spans fashion AND non-fashion (beauty, home, tech, lifestyle). It contains these exact product types:
${typeList}

User query: "${query}"

Decide intent and return ONLY a JSON object with these exact fields:
- "intent": "browse" if the user is shopping a category | "pairing" if they want what to wear with something they have | "vibe" if it's an abstract aesthetic / mood with no specific category
- "types": array of product types from the list above. Pick the closest matches — may include non-fashion types (e.g. "hair cream" → ["Hair Cream"], "candles" → ["Candle"], "perfume" → ["Fragrance"]). For broad fashion terms include adjacent types (e.g. "pants" → ["Pants","Shorts","Activewear"], "shoes" → ["Sneakers","Boots","Sandals","Heels","Loafers","Flats","Mules"]). For specific terms narrow it. Empty array when intent is "pairing" or "vibe".
- "anchor_type": for intent=pairing only, the type of the anchor item. null otherwise.
- "pair_types": for intent=pairing only, the complementary types to surface (NOT the anchor). null otherwise.
- "keywords": the query stripped of the category noun, used for in-category ranking. Keep as a short phrase.

Examples:
"pants"                          → {"intent":"browse","types":["Pants","Shorts","Activewear"],"anchor_type":null,"pair_types":null,"keywords":""}
"hair cream"                     → {"intent":"browse","types":["Hair Cream"],"anchor_type":null,"pair_types":null,"keywords":""}
"candles"                        → {"intent":"browse","types":["Candle"],"anchor_type":null,"pair_types":null,"keywords":""}
"white sneakers"                 → {"intent":"browse","types":["Sneakers"],"anchor_type":null,"pair_types":null,"keywords":"white"}
"what to wear with white sneakers" → {"intent":"pairing","types":[],"anchor_type":"Sneakers","pair_types":["Top","Pants","Shorts","Hat"],"keywords":"white"}
"quiet luxury"                   → {"intent":"vibe","types":[],"anchor_type":null,"pair_types":null,"keywords":"quiet luxury"}

IMPORTANT: only choose types that appear in the list above. If no listed type matches the query, return an empty types array and let dense+BM25 retrieval handle it.

Respond with ONLY the JSON object, no prose, no markdown.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 250,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json() as { content?: Array<{ type: string; text?: string }> };
  const text = json.content?.find(b => b.type === 'text')?.text ?? '';
  const cleaned = text.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim();
  const raw = JSON.parse(cleaned) as Partial<QueryExpansion>;

  // Defensive normalisation: clamp Haiku's output to the canonical set so a
  // hallucinated type can't be passed to the SQL filter.
  const allowed = new Set<string>(canonicalTypes);
  const intent: Intent = raw.intent === 'pairing' || raw.intent === 'vibe' ? raw.intent : 'browse';
  const types = (raw.types ?? []).filter(t => allowed.has(t));
  const pair_types = (raw.pair_types ?? []).filter(t => allowed.has(t));
  const anchor_type = raw.anchor_type && allowed.has(raw.anchor_type) ? raw.anchor_type : null;

  return {
    intent,
    types,
    anchor_type: intent === 'pairing' ? anchor_type : null,
    pair_types:  intent === 'pairing' && pair_types.length > 0 ? pair_types : null,
    keywords:    typeof raw.keywords === 'string' ? raw.keywords : query,
  };
}

/** Static-analyzer → expansion. Used as a hard-timeout fallback. */
function expansionFromStatic(query: string): QueryExpansion {
  const a = analyzeQuery(query);
  if (a.kind === 'pairing') {
    return { intent: 'pairing', types: [], anchor_type: null, pair_types: a.pair_types, keywords: a.keywords.join(' ') };
  }
  if (a.kind === 'typed') {
    return { intent: 'browse', types: a.types, anchor_type: null, pair_types: null, keywords: a.keywords.join(' ') };
  }
  return { intent: 'vibe', types: [], anchor_type: null, pair_types: null, keywords: query };
}

// ── OpenAI: text embedding (1536-dim) ────────────────────────────────────────

async function embedTextOpenAI(text: string, openaiKey: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
  });
  if (!res.ok) throw new Error(`OpenAI embed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json() as { data?: Array<{ embedding?: number[] }> };
  const vec = json.data?.[0]?.embedding;
  if (!vec?.length) throw new Error('OpenAI returned empty embedding');
  return vec;
}

// ── TwelveLabs: text→video embedding (vibe lane only) ────────────────────────

async function embedTextTwelveLabs(text: string, twelveLabsKey: string): Promise<number[]> {
  const res = await fetch('https://api.twelvelabs.io/v1.3/embed-v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': twelveLabsKey },
    body: JSON.stringify({
      input_type: 'text',
      model_name: 'marengo3.0',
      text: { input_text: text },
    }),
  });
  if (!res.ok) throw new Error(`TwelveLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json() as { data?: Array<{ embedding?: number[] }> };
  const vec = json.data?.[0]?.embedding;
  if (!vec?.length) throw new Error('TwelveLabs returned empty text embedding');
  return vec;
}

// ── Combined query cache (embedding + Haiku expansion) ───────────────────────

function normalizeQueryForCache(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

function parsePgVector(raw: unknown): number[] | null {
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const parts = trimmed.slice(1, -1).split(',');
  const out = new Array<number>(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const n = Number(parts[i]);
    if (!Number.isFinite(n)) return null;
    out[i] = n;
  }
  return out;
}

function toPgVector(v: number[]): string {
  return '[' + v.join(',') + ']';
}

interface CachePayload {
  embedding: number[] | null;
  expansion: QueryExpansion | null;
}

async function readCache(
  admin: ReturnType<typeof createClient>,
  key: string,
): Promise<CachePayload> {
  try {
    const { data } = await admin
      .from('query_embeddings')
      .select('embedding, expansion, embedding_v, expansion_v, expires_at')
      .eq('query_text', key)
      .maybeSingle();
    if (!data) return { embedding: null, expansion: null };
    const row = data as {
      embedding?: unknown;
      expansion?: unknown;
      embedding_v?: number | null;
      expansion_v?: number | null;
      expires_at?: string | null;
    };
    const expired = row.expires_at ? new Date(row.expires_at).getTime() < Date.now() : false;
    if (expired) return { embedding: null, expansion: null };
    const embedding = (row.embedding_v ?? 0) === EMBED_V ? parsePgVector(row.embedding) : null;
    const expansion = (row.expansion_v ?? 0) === EXPANSION_V ? ((row.expansion as QueryExpansion | null) ?? null) : null;
    return { embedding, expansion };
  } catch {
    return { embedding: null, expansion: null };
  }
}

async function writeCache(
  admin: ReturnType<typeof createClient>,
  key: string,
  embedding: number[] | null,
  expansion: QueryExpansion | null,
): Promise<void> {
  if (!embedding && !expansion) return;
  const expiresAt = new Date(Date.now() + CACHE_TTL_DAYS * 86400 * 1000).toISOString();
  const row: Record<string, unknown> = { query_text: key, expires_at: expiresAt };
  if (embedding) { row.embedding = toPgVector(embedding); row.embedding_v = EMBED_V; }
  if (expansion) { row.expansion = expansion;             row.expansion_v = EXPANSION_V; }
  // Upsert so a query whose embedding came back first can later attach its
  // expansion (and vice-versa) without overwriting the other column.
  admin
    .from('query_embeddings')
    .upsert(row, { onConflict: 'query_text' })
    .then(() => {});
}

// ── Hybrid SQL helpers ───────────────────────────────────────────────────────

function normaliseHybridRows(rows: Array<Record<string, unknown>>): SearchResult[] {
  return rows.map(r => ({
    ...r,
    entity_type: 'creative' as const,
    score: 0,
  })) as unknown as SearchResult[];
}

function rrfFuse(sets: SearchResult[][], topK: number): SearchResult[] {
  const scoreMap = new Map<string, { item: SearchResult; score: number }>();
  for (const set of sets) {
    set.forEach((item, idx) => {
      const rank = idx + 1;
      const rrf  = 1.0 / (60 + rank);
      const prev = scoreMap.get(item.id);
      if (prev) prev.score += rrf;
      else scoreMap.set(item.id, { item, score: rrf });
    });
  }
  return Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ item, score }) => ({ ...item, score }));
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonRes({ ok: false, error: 'Use POST' }, 405);

  const supabaseUrl   = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anthropicKey  = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  const openaiKey     = Deno.env.get('OPENAI_API_KEY') ?? '';
  const twelveLabsKey = Deno.env.get('TWELVELABS_API_KEY') ?? '';

  if (!supabaseUrl || !serviceKey) return jsonRes({ ok: false, error: 'Supabase env missing' }, 500);

  let body: { query?: string; k?: number; gender?: string; session_id?: string; user_id?: string; exclude_ids?: string[] };
  try { body = await req.json(); } catch { return jsonRes({ ok: false, error: 'Invalid JSON' }, 400); }

  const { query, session_id, user_id } = body;
  const k = Math.min(Math.max(body.k ?? 24, 5), 60);
  const excludeIds = Array.isArray(body.exclude_ids)
    ? body.exclude_ids.filter((s): s is string => typeof s === 'string').slice(0, 500)
    : [];

  if (!query?.trim()) return jsonRes({ ok: false, error: 'query required' }, 400);

  const admin = createClient(supabaseUrl, serviceKey);
  const gender = body.gender ?? null;
  const cacheKey = normalizeQueryForCache(query);
  // Load canonical types from the DB view (cached in module scope, refreshed every 5 min).
  const canonicalTypes = await loadCanonicalTypes(admin);
  // ── Step 1: cache lookup ──────────────────────────────────────────────────
  const cache = await readCache(admin, cacheKey);

  // ── Step 2: in parallel, fill the gaps (embedding + Haiku expansion) ─────
  const needEmbed     = !cache.embedding && !!openaiKey;
  const needExpansion = !cache.expansion;

  const embedTask: Promise<number[] | null> = cache.embedding
    ? Promise.resolve(cache.embedding)
    : needEmbed
      ? embedTextOpenAI(query, openaiKey).catch(err => {
          console.warn('[nl-search] embed failed:', err);
          return null;
        })
      : Promise.resolve(null);

  // Tagged so we can avoid caching low-quality static fallbacks. Only the
  // real Haiku branch tags `_source:'haiku'` — timeouts and errors fall
  // through to the static analyzer and stay uncached so the next request
  // can retry the LLM.
  type TaggedExpansion = QueryExpansion & { _source: 'haiku' | 'static' };
  const expansionTask: Promise<TaggedExpansion> = cache.expansion
    ? Promise.resolve({ ...cache.expansion, _source: 'haiku' })
    : needExpansion && anthropicKey
      ? Promise.race([
          expandQueryWithHaiku(query, anthropicKey, canonicalTypes)
            .then(e => ({ ...e, _source: 'haiku' as const }))
            .catch(err => {
              console.warn('[nl-search] haiku expand failed:', err);
              return { ...expansionFromStatic(query), _source: 'static' as const };
            }),
          new Promise<TaggedExpansion>(resolve =>
            setTimeout(() => resolve({ ...expansionFromStatic(query), _source: 'static' as const }), HAIKU_TIMEOUT_MS)
          ),
        ])
      : Promise.resolve({ ...expansionFromStatic(query), _source: 'static' as const });

  const [embedding, expansion] = await Promise.all([embedTask, expansionTask]);

  // Visual lane (Marengo): only fire for vibe queries where dense+BM25
  // alone struggle. Sequential after the parallel block because we need
  // the resolved intent first — but the cost is paid only on vibes.
  let visualEmbedding: number[] | null = null;
  if (expansion.intent === 'vibe' && twelveLabsKey) {
    visualEmbedding = await Promise.race([
      embedTextTwelveLabs(query, twelveLabsKey).catch(err => {
        console.warn('[nl-search] marengo failed:', err);
        return null;
      }),
      new Promise<null>(resolve => setTimeout(() => resolve(null), TWELVELABS_TIMEOUT_MS)),
    ]);
  }

  // Backfill cache for next time (fire-and-forget upsert). Skip when the
  // expansion is the static fallback — caching it would lock the query
  // into degraded results for CACHE_TTL_DAYS.
  const cacheableExpansion = expansion._source === 'haiku' ? expansion : null;
  if ((needEmbed && embedding) || (needExpansion && cacheableExpansion)) {
    writeCache(admin, cacheKey, embedding, cacheableExpansion);
  }

  // ── Step 3: choose filter_types from expansion ───────────────────────────
  const filterTypes: string[] | null =
    expansion.intent === 'pairing' ? expansion.pair_types
    : expansion.intent === 'browse' && expansion.types.length > 0 ? expansion.types
    : null;

  // BM25 input: keywords stripped of category noun for browse/pairing,
  // raw query for vibe (no noun was extracted).
  const bm25Text = expansion.intent === 'vibe'
    ? query
    : (expansion.keywords?.trim() || query);

  // ── Step 4: hybrid SQL retrieval ─────────────────────────────────────────
  const queryEmbedding = embedding ?? new Array(1536).fill(0);
  const denseRpc = admin.rpc('search_creatives_hybrid', {
    query_embedding:  toPgVector(queryEmbedding),
    query_text:       bm25Text,
    k,
    filter_gender:    gender,
    filter_types:     filterTypes,
    require_elite:    false,
    exclude_ids:      excludeIds,
    min_results:      MIN_RESULTS_THRESHOLD,
    max_per_product:  MAX_PER_PRODUCT,
  });

  const visualRpc = visualEmbedding
    ? admin.rpc('search_creatives_visual', {
        query_embedding: toPgVector(visualEmbedding),
        k:               Math.ceil(k * 0.5),
        filter_gender:   gender,
      })
    : Promise.resolve({ data: [] as Array<Record<string, unknown>> });

  // Speculatively launch the products lane in parallel so warm requests
  // don't pay a second sequential RPC round-trip. Most browse queries end
  // up needing it anyway (creative pool starves for non-fashion). The
  // result is consumed in Step 4b — discarded if the creative pool was
  // already full of on-type matches.
  const productsRpcSpeculative = admin.rpc('search_products_hybrid', {
    query_embedding: toPgVector(queryEmbedding),
    query_text:      bm25Text,
    k,
    filter_gender:   gender,
    filter_types:    filterTypes,
    exclude_ids:     [],
  });

  const [denseRes, visualRes] = await Promise.all([denseRpc, visualRpc]);

  if ((denseRes as { error?: { message: string } }).error) {
    const err = (denseRes as { error: { message: string } }).error;
    console.error('[nl-search] hybrid RPC error:', err);
    return jsonRes({ ok: false, error: 'search_failed', detail: err.message }, 500);
  }

  const denseRows = ((denseRes as { data?: unknown }).data ?? []) as Array<Record<string, unknown>>;
  const denseSet  = normaliseHybridRows(denseRows);

  let fused: SearchResult[];
  const visualRows = ((visualRes as { data?: unknown }).data ?? []) as Array<Record<string, unknown>>;
  if (visualRows.length > 0) {
    const visualSet: SearchResult[] = visualRows.map(r => ({
      id:                r.creative_id as string,
      entity_type:       'creative' as const,
      product_id:        r.id as string,
      video_url:         (r.creative_video_url as string) ?? null,
      thumbnail_url:     (r.creative_thumbnail_url as string) ?? null,
      affiliate_url:     null,
      duration_seconds:  null,
      is_elite:          null,
      product_name:      (r.name as string) ?? null,
      product_brand:     (r.brand as string) ?? null,
      product_price:     (r.price as string) ?? null,
      product_image_url: (r.image_url as string) ?? null,
      product_url:       (r.url as string) ?? null,
      product_gender:    (r.gender as string) ?? null,
      product_type:      (r.type as string) ?? null,
      concept_doc:       (r.concept_doc as string) ?? null,
      concept_facets:    (r.concept_facets as Record<string, unknown>) ?? null,
      rrf_score:         (r.rrf_score as number) ?? 0,
      dense_rank:        (r.dense_rank as number) ?? null,
      bm25_rank:         null,
      score:             0,
    }));
    fused = rrfFuse([denseSet, visualSet], k);
  } else {
    fused = denseSet.map(c => ({ ...c, score: c.rrf_score ?? 0 }));
  }

  // Outfit-intent guard: when the user asks for an outfit/look/fit, suppress
  // accessory-only types unless they explicitly mentioned them.
  const isOutfitIntent =
    (expansion.intent === 'pairing' || expansion.intent === 'vibe') &&
    /\b(outfit|look|fit|wear|style|ensemble|set)\b/i.test(query);
  if (isOutfitIntent) {
    const explicitlyAsks = /\b(underwear|bra|panties|lingerie|brief|boxer|thong|swimsuit|bikini|trunks|accessor|jewell?ery|necklace|earrings?|bracelet|watch|hat|cap|beanie|scarf|belt|bag|sunglass|sock)\b/i.test(query);
    if (!explicitlyAsks) {
      const blocked = new Set(['underwear', 'lingerie', 'accessories', 'jewellery', 'jewelry', 'socks', 'hosiery']);
      fused = fused.filter(c => !blocked.has((c.product_type ?? '').toLowerCase()));
    }
  }

  // Dedupe by product so a single product with multiple creatives doesn't
  // stack the grid.
  const seen = new Set<string>();
  let dedupedResults: SearchResult[] = [];
  for (const c of fused) {
    if (c.product_id && seen.has(c.product_id)) continue;
    if (c.product_id) seen.add(c.product_id);
    dedupedResults.push(c);
  }

  // ── Step 4a: prune off-type pad when filter_types is set ────────────────
  // search_creatives_hybrid soft-relaxes the type filter when the strict
  // pool is below min_results; the relaxed rows arrive tagged
  // `type_match=false`. Those padding rows are usually unrelated junk
  // (e.g. a tee for a "candles" search). Drop them up front and let the
  // products lane fill the gap with on-type matches.
  let prunedOffType = 0;
  if (filterTypes && filterTypes.length > 0) {
    const onType = dedupedResults.filter(r => r.type_match === true);
    if (onType.length < dedupedResults.length) {
      prunedOffType = dedupedResults.length - onType.length;
      // Reset `seen` to just the on-type product ids so the products
      // fallback doesn't re-skip the freshly pruned ones.
      seen.clear();
      for (const r of onType) if (r.product_id) seen.add(r.product_id);
      dedupedResults = onType;
    }
  }

  // ── Step 4b: products fallback when creative pool is starved ────────────
  // The creative index excludes products that have no live video; for cold
  // (e.g. brand-new) categories the user would otherwise see an empty grid.
  // Two-pass strategy: first try the products lane respecting filter_types,
  // and if that returns nothing usable (e.g. "toothbrush" mapped to
  // ["Haircare"] but the actual toothbrush rows have type=null), retry
  // without the type filter so dense+BM25 can find them by name/description.
  let productsAppended = 0;
  let productsFallbackPasses = 0;
  if (dedupedResults.length < k) {
    const callProducts = async (types: string[] | null): Promise<Array<Record<string, unknown>>> => {
      productsFallbackPasses++;
      // Pass 1 reuses the speculative RPC fired in Step 4 (same args).
      const rpcPromise = (types === filterTypes && productsFallbackPasses === 1)
        ? productsRpcSpeculative
        : admin.rpc('search_products_hybrid', {
            query_embedding: toPgVector(queryEmbedding),
            query_text:      bm25Text,
            k,
            filter_gender:   gender,
            filter_types:    types,
            exclude_ids:     [],
          });
      const { data: pRows, error: pErr } = await rpcPromise;
      if (pErr) {
        console.warn('[nl-search] products fallback rpc error:', pErr);
        return [];
      }
      return Array.isArray(pRows) ? (pRows as Array<Record<string, unknown>>) : [];
    };

    const appendRows = (rows: Array<Record<string, unknown>>) => {
      for (const r of rows) {
        const productId = r.product_id as string;
        if (!productId || seen.has(productId)) continue;
        seen.add(productId);
        const row: SearchResult = {
          id:                productId,
          entity_type:       'creative' as const,
          product_id:        productId,
          video_url:         null,
          thumbnail_url:     null,
          affiliate_url:     null,
          duration_seconds:  null,
          is_elite:          null,
          product_name:      (r.product_name as string) ?? null,
          product_brand:     (r.product_brand as string) ?? null,
          product_price:     (r.product_price as string) ?? null,
          product_image_url: (r.product_image_url as string) ?? null,
          product_url:       (r.product_url as string) ?? null,
          product_gender:    (r.product_gender as string) ?? null,
          product_type:      (r.product_type as string) ?? null,
          concept_doc:       (r.concept_doc as string) ?? null,
          concept_facets:    (r.concept_facets as Record<string, unknown>) ?? null,
          rrf_score:         (r.rrf_score as number) ?? 0,
          dense_rank:        (r.dense_rank as number) ?? null,
          bm25_rank:         (r.bm25_rank as number) ?? null,
          score:             (r.rrf_score as number) ?? 0,
        };
        dedupedResults.push(row);
        productsAppended++;
        if (dedupedResults.length >= k) return true;
      }
      return false;
    };

    try {
      // Pass 1: respect filter_types if Haiku gave us any.
      const firstRows = await callProducts(filterTypes);
      const filled = appendRows(firstRows);

      // Pass 2: if the type-filtered pass was empty AND we have a non-empty
      // query, retry with no type filter so BM25 can rescue terms that
      // Haiku mapped to the wrong canonical type (or types whose products
      // have type=null, like "toothbrush").
      if (!filled && dedupedResults.length < k && filterTypes && filterTypes.length > 0) {
        const looseRows = await callProducts(null);
        appendRows(looseRows);
      }
    } catch (err) {
      console.warn('[nl-search] products fallback failed:', err);
    }
  } else {
    // Creative pool was already full \u2014 silently drain the speculative
    // products RPC so its promise rejection (if any) doesn't bubble up.
    Promise.resolve(productsRpcSpeculative).catch(() => {});
  }

  // ── Step 4c: BM25-aware re-rank when products lane contributed ──────────
  // When filter_types is set and only a sparse creative lane survived
  // (e.g. "candles" → one Decor creative for a mirror, products lane fills
  // with seven actual candles), the appended products should outrank the
  // creative if they actually hit the BM25 query and the creative didn't.
  // Otherwise unrelated-but-on-type creatives keep grabbing pole position.
  if (filterTypes && productsAppended > 0) {
    const bm25Score = (r: SearchResult): number => {
      // Lower bm25_rank = better. Treat null as "no BM25 hit".
      return r.bm25_rank == null ? Number.POSITIVE_INFINITY : r.bm25_rank;
    };
    dedupedResults.sort((a, b) => {
      const ba = bm25Score(a);
      const bb = bm25Score(b);
      // Anyone with a real BM25 hit wins over no-hit rows.
      const aHit = Number.isFinite(ba) ? 1 : 0;
      const bHit = Number.isFinite(bb) ? 1 : 0;
      if (aHit !== bHit) return bHit - aHit;
      if (aHit && ba !== bb) return ba - bb;
      // Tie-break by RRF / dense score.
      return (b.rrf_score ?? 0) - (a.rrf_score ?? 0);
    });
  }

  const topScore = dedupedResults[0]?.score ?? null;
  const resultCount = dedupedResults.length;

  // ── Step 5: log and respond ──────────────────────────────────────────────
  const queryPlan = {
    intent: expansion.intent === 'pairing' ? 'outfit_pairing'
          : expansion.intent === 'vibe'    ? 'vibe_browse'
          : 'product_find',
    rewrites: [],
    constraints: { gender: gender ?? undefined },
    result_shape: ['products', 'looks'],
    anchor_type:    expansion.anchor_type,
    pair_types:     expansion.pair_types,
    resolved_types: filterTypes,
    branch:         expansion.intent,
  };

  // Fire-and-forget the analytics write so it doesn't add ~150-300ms to
  // the response. The query_id was previously surfaced for click attribution
  // — clients can now derive it server-side from raw_query + session_id.
  admin
    .rpc('log_search_query', {
      p_raw_query:    query,
      p_result_count: resultCount,
      p_top_score:    topScore,
      p_query_plan:   queryPlan as unknown as Record<string, unknown>,
      p_user_id:      user_id ?? null,
      p_session_id:   session_id ?? null,
    })
    .then(() => {});

  return jsonRes({
    ok: true,
    results: dedupedResults,
    query_plan: queryPlan,
    cold_miss: resultCount < 5 || topScore === null || (expansion.intent === 'vibe' && topScore < 0.020),
    query_id: null,
    meta: {
      result_count:    resultCount,
      top_score:       topScore,
      branch:          expansion.intent,
      resolved_types:  filterTypes,
      anchor_type:     expansion.anchor_type,
      bm25_text:       bm25Text,
      embedding_cache_hit: !!cache.embedding,
      expansion_cache_hit: !!cache.expansion,
      visual_lane:     visualEmbedding != null,
      products_appended: productsAppended,
      products_fallback_passes: productsFallbackPasses,
      pruned_off_type:   prunedOffType,
      canonical_types_count: canonicalTypes.length,
      expansion: {
        intent:      expansion.intent,
        types:       expansion.types,
        anchor_type: expansion.anchor_type,
        pair_types:  expansion.pair_types,
        keywords:    expansion.keywords,
        source:      expansion._source,
      },
    },
  });
});
