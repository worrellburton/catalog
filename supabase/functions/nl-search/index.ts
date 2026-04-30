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
const HAIKU_TIMEOUT_MS      = 600;
const TWELVELABS_TIMEOUT_MS = 600;

// Canonical product.type values present in the catalog. Sourced from the
// live `select distinct type from products` — keep in sync as new types
// land. Haiku is constrained to choose only from this set so it can't
// invent labels that don't filter to anything.
const CANONICAL_TYPES = [
  'Top', 'Jacket', 'Pants', 'Shorts', 'Skirt', 'Dress', 'Coat',
  'Underwear', 'Activewear', 'Loungewear', 'Swimwear',
  'Sneakers', 'Boots', 'Sandals', 'Heels', 'Loafers', 'Flats', 'Mules',
  'Hat', 'Bag', 'Scarf', 'Socks',
  'Fragrance', 'Skincare', 'Book', 'Yoga',
] as const;

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
}

type SearchResult = CreativeRow & { score: number };

// ── Claude Haiku: query expansion ────────────────────────────────────────────

async function expandQueryWithHaiku(query: string, anthropicKey: string): Promise<QueryExpansion> {
  const typeList = CANONICAL_TYPES.join(', ');
  const prompt = `You are a fashion catalog search planner. The catalog has these exact product types:
${typeList}

User query: "${query}"

Decide intent and return ONLY a JSON object with these exact fields:
- "intent": "browse" if the user is shopping a category | "pairing" if they want what to wear with something they have | "vibe" if it's an abstract aesthetic / mood with no specific category
- "types": array of product types from the list above. For broad terms include ALL adjacent types (e.g. "pants" → ["Pants","Shorts","Activewear"], "shoes" → ["Sneakers","Boots","Sandals","Heels","Loafers","Flats","Mules"]). For specific terms narrow it (e.g. "jeans" → ["Pants"], "loafers" → ["Loafers"]). Empty array when intent is "pairing" or "vibe".
- "anchor_type": for intent=pairing only, the type of the anchor item (e.g. "white sneakers" → "Sneakers"). null otherwise.
- "pair_types": for intent=pairing only, the complementary types to surface (NOT the anchor). E.g. anchor=Sneakers → ["Top","Pants","Shorts","Hat"]. null otherwise.
- "keywords": the query stripped of the category noun, used for in-category ranking. E.g. "white sneakers" → "white", "summer dress for wedding" → "summer wedding". Keep as a short phrase.

Examples:
"pants"                          → {"intent":"browse","types":["Pants","Shorts","Activewear"],"anchor_type":null,"pair_types":null,"keywords":""}
"jeans"                          → {"intent":"browse","types":["Pants"],"anchor_type":null,"pair_types":null,"keywords":"jeans"}
"white sneakers"                 → {"intent":"browse","types":["Sneakers"],"anchor_type":null,"pair_types":null,"keywords":"white"}
"what to wear with white sneakers" → {"intent":"pairing","types":[],"anchor_type":"Sneakers","pair_types":["Top","Pants","Shorts","Hat"],"keywords":"white"}
"quiet luxury"                   → {"intent":"vibe","types":[],"anchor_type":null,"pair_types":null,"keywords":"quiet luxury"}

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
  const allowed = new Set<string>(CANONICAL_TYPES);
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
      .select('embedding, expansion')
      .eq('query_text', key)
      .maybeSingle();
    if (!data) return { embedding: null, expansion: null };
    const row = data as { embedding?: unknown; expansion?: unknown };
    return {
      embedding: parsePgVector(row.embedding),
      expansion: (row.expansion as QueryExpansion | null) ?? null,
    };
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
  const row: Record<string, unknown> = { query_text: key };
  if (embedding) row.embedding = toPgVector(embedding);
  if (expansion) row.expansion = expansion;
  // Upsert so we can backfill expansion on rows cached before migration 064
  // (and vice-versa).
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

  const expansionTask: Promise<QueryExpansion> = cache.expansion
    ? Promise.resolve(cache.expansion)
    : needExpansion && anthropicKey
      ? Promise.race([
          expandQueryWithHaiku(query, anthropicKey).catch(err => {
            console.warn('[nl-search] haiku expand failed:', err);
            return expansionFromStatic(query);
          }),
          new Promise<QueryExpansion>(resolve =>
            setTimeout(() => resolve(expansionFromStatic(query)), HAIKU_TIMEOUT_MS)
          ),
        ])
      : Promise.resolve(expansionFromStatic(query));

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

  // Backfill cache for next time (fire-and-forget upsert).
  if ((needEmbed && embedding) || (needExpansion && expansion)) {
    writeCache(admin, cacheKey, embedding, expansion);
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
    query_embedding: toPgVector(queryEmbedding),
    query_text:      bm25Text,
    k,
    filter_gender:   gender,
    filter_types:    filterTypes,
    require_elite:   false,
    exclude_ids:     excludeIds,
  });

  const visualRpc = visualEmbedding
    ? admin.rpc('search_creatives_visual', {
        query_embedding: toPgVector(visualEmbedding),
        k:               Math.ceil(k * 0.5),
        filter_gender:   gender,
      })
    : Promise.resolve({ data: [] as Array<Record<string, unknown>> });

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
  const dedupedResults: SearchResult[] = [];
  for (const c of fused) {
    if (c.product_id && seen.has(c.product_id)) continue;
    if (c.product_id) seen.add(c.product_id);
    dedupedResults.push(c);
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

  const { data: logData } = await admin.rpc('log_search_query', {
    p_raw_query:    query,
    p_result_count: resultCount,
    p_top_score:    topScore,
    p_query_plan:   queryPlan as unknown as Record<string, unknown>,
    p_user_id:      user_id ?? null,
    p_session_id:   session_id ?? null,
  });

  return jsonRes({
    ok: true,
    results: dedupedResults,
    query_plan: queryPlan,
    cold_miss: resultCount < 5 || topScore === null || (expansion.intent === 'vibe' && topScore < 0.020),
    query_id: logData ?? null,
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
    },
  });
});
