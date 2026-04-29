// nl-search — Natural-language search orchestrator.
//
// Pipeline:
//   1. QueryPlan via Claude Haiku            — classify intent, generate rewrites, extract constraints
//   2. Embed query + rewrites                — TwelveLabs Marengo-retrieval-2.7 text embed (1024-dim), parallel
//   3. Hybrid retrieval                      — search_products_hybrid + search_looks_hybrid RPCs per embedding
//   4. RRF fusion                            — merge all retrieval sets into one ranked list
//   5. Graph augment                         — for outfit_pairing intent, add entity_edges neighbours
//   6. Log query                             — log_search_query RPC, return cold_miss flag
//
// Request body:
//   { query: string, k?: number, gender?: string, session_id?: string, user_id?: string }
//
// Response:
//   { ok: true, results: SearchResult[], query_plan: QueryPlan, cold_miss: boolean, query_id: string }
//
// Required secrets:
//   ANTHROPIC_API_KEY   — Claude Haiku (QueryPlan generation)
//   OPENAI_API_KEY     — text-embedding-3-small (1536-dim, text lanes)
//   TWELVELABS_API_KEY — Marengo 3.0 (512-dim, visual creative lane only)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────

type SearchIntent = 'outfit_pairing' | 'occasion_lookup' | 'product_find' | 'vibe_browse' | 'lookalike' | 'ambiguous';
type ResultSurface = 'looks' | 'products' | 'creatives';

interface QueryPlan {
  intent: SearchIntent;
  rewrites: string[];
  constraints: { gender?: string; occasion?: string; price_band?: string };
  result_shape: ResultSurface[];
  anchor_name?: string;   // for outfit_pairing: what is the anchor item ("white jeans")
}

interface ProductRow {
  id: string;
  entity_type: 'product';
  name: string;
  brand: string;
  price: string;
  image_url: string;
  description: string;
  concept_doc: string | null;
  concept_facets: Record<string, unknown> | null;
  gender: string;
  type: string;
  url: string;
  rrf_score: number;
  dense_rank: number | null;
  bm25_rank:  number | null;
}

interface LookRow {
  id: string;
  entity_type: 'look';
  title: string;
  creator_handle: string;
  description: string;
  thumbnail_url: string;
  video_path: string;
  gender: string;
  concept_doc: string | null;
  concept_facets: Record<string, unknown> | null;
  rrf_score: number;
  dense_rank: number | null;
  bm25_rank:  number | null;
}

type SearchResult = (ProductRow | LookRow) & { score: number };

// ── Claude: QueryPlan generation ─────────────────────────────────────────────

async function buildQueryPlan(query: string, anthropicKey: string): Promise<QueryPlan> {
  const prompt = `You are a fashion search query planner. Analyze the user's query and output a JSON QueryPlan.

Query: "${query}"

Output a JSON object with these exact fields:
- "intent": one of ["outfit_pairing","occasion_lookup","product_find","vibe_browse","lookalike","ambiguous"]
  • outfit_pairing   = "what to wear with X", "what goes with Y"
  • occasion_lookup  = "red carpet", "beach wedding", "job interview outfit"
  • product_find     = looking for a specific product type ("white sneakers", "linen trousers")
  • vibe_browse      = aesthetic/mood browsing ("quiet luxury", "Y2K", "coastal grandmother")
  • lookalike        = "similar to X", "like the dress Taylor wore at..."
  • ambiguous        = unclear
- "rewrites": array of 2 alternative phrasings of the same query that would help a search engine find the right items. Be specific and concrete.
- "constraints": object with optional keys: "gender" (men|women|unisex), "occasion" (string), "price_band" (budget|mid|luxury)
- "result_shape": ordered array of surfaces to fill. Looks = outfit videos, products = individual items. Example: ["looks","products"] or ["products","looks"]
- "anchor_name": ONLY if intent=outfit_pairing, the specific item being styled (e.g. "white jeans", "leather trench coat"). Otherwise omit.

Respond with ONLY the JSON object.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const json = await res.json() as { content?: Array<{ type: string; text?: string }> };
  const text = json.content?.find(b => b.type === 'text')?.text ?? '';
  const cleaned = text.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim();

  const plan = JSON.parse(cleaned) as QueryPlan;
  // Ensure required fields have sensible defaults
  plan.intent       = plan.intent       ?? 'ambiguous';
  plan.rewrites     = plan.rewrites     ?? [];
  plan.constraints  = plan.constraints  ?? {};
  plan.result_shape = plan.result_shape ?? ['products', 'looks'];
  return plan;
}

// Fallback when Claude is unavailable: simple heuristic plan
function heuristicQueryPlan(query: string): QueryPlan {
  const q = query.toLowerCase();
  const isPairing = /\b(wear with|goes with|pair with|match with|style with)\b/.test(q);
  const isOccasion = /\b(wedding|party|beach|work|office|casual|formal|date night|red carpet|vacation)\b/.test(q);
  const isVibe = /\b(aesthetic|vibe|mood|core|style|look|inspired|like|similar)\b/.test(q);
  const gender = /\b(women|woman|ladies|girls?)\b/.test(q) ? 'women'
               : /\b(men|man|guys?|boys?)\b/.test(q) ? 'men' : undefined;

  return {
    intent: isPairing ? 'outfit_pairing' : isOccasion ? 'occasion_lookup' : isVibe ? 'vibe_browse' : 'product_find',
    rewrites: [query],
    constraints: { gender },
    result_shape: isPairing ? ['products', 'looks'] : ['looks', 'products'],
    anchor_name: isPairing ? query.replace(/^.*(wear with|goes with|pair with|match with|style with)\s*/i, '').trim() : undefined,
  };
}

// ── OpenAI: text embedding (text-embedding-3-small, 1536-dim) ──────────────

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

// ── TwelveLabs: text→video embedding (Marengo 3.0, 512-dim, visual lane only) ────

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

function toPgVector(v: number[]): string {
  return '[' + v.join(',') + ']';
}

// ── RRF fusion across multiple retrieval sets ─────────────────────────────────
// Each set is an array of results with a .rrf_score (from the DB) and an .id.
// We sum 1/(60+rank) across sets where a given id appears, producing a fused score.

function rrfFuse(
  sets: Array<Array<SearchResult>>,
  topK: number
): SearchResult[] {
  const scoreMap = new Map<string, { item: SearchResult; score: number }>();

  for (const set of sets) {
    set.forEach((item, idx) => {
      const rank = idx + 1; // 1-based
      const rrf  = 1.0 / (60 + rank);
      const prev = scoreMap.get(item.id);
      if (prev) {
        prev.score += rrf;
      } else {
        scoreMap.set(item.id, { item, score: rrf });
      }
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

  let body: { query?: string; k?: number; gender?: string; session_id?: string; user_id?: string };
  try { body = await req.json(); } catch { return jsonRes({ ok: false, error: 'Invalid JSON' }, 400); }

  const { query, session_id, user_id } = body;
  const k = Math.min(Math.max(body.k ?? 20, 5), 50);

  if (!query?.trim()) return jsonRes({ ok: false, error: 'query required' }, 400);

  const admin = createClient(supabaseUrl, serviceKey);

  // ── Step 1+2 (parallel): QueryPlan + embed raw query ─────────────────────
  const [planResult, rawEmbedResult] = await Promise.allSettled([
    anthropicKey ? buildQueryPlan(query, anthropicKey)  : Promise.resolve(heuristicQueryPlan(query)),
    openaiKey    ? embedTextOpenAI(query, openaiKey)    : Promise.reject(new Error('no OPENAI_API_KEY')),
  ]);

  const queryPlan: QueryPlan = planResult.status === 'fulfilled'
    ? planResult.value
    : heuristicQueryPlan(query);

  const canEmbed = rawEmbedResult.status === 'fulfilled';
  const rawEmbedding = canEmbed ? rawEmbedResult.value : null;

  // ── Step 2b: embed rewrites (best-effort, parallel) ──────────────────────
  let rewriteEmbeddings: number[][] = [];
  if (canEmbed && openaiKey && queryPlan.rewrites.length > 0) {
    const rewriteResults = await Promise.allSettled(
      queryPlan.rewrites.slice(0, 2).map(r => embedTextOpenAI(r, openaiKey))
    );
    rewriteEmbeddings = rewriteResults
      .filter((r): r is PromiseFulfilledResult<number[]> => r.status === 'fulfilled')
      .map(r => r.value);
  }

  // Embed the raw query via TwelveLabs for the visual lane (512-dim, cross-modal text→video)
  let visualEmbedding: number[] | null = null;
  if (twelveLabsKey) {
    const visualResult = await Promise.allSettled([embedTextTwelveLabs(query, twelveLabsKey)]);
    if (visualResult[0].status === 'fulfilled') visualEmbedding = visualResult[0].value;
  }

  const allEmbeddings: number[][] = [
    ...(rawEmbedding ? [rawEmbedding] : []),
    ...rewriteEmbeddings,
  ];

  // ── Step 3: Hybrid retrieval (parallel across embeddings + entity types) ──
  const productSets: SearchResult[][] = [];
  const lookSets:    SearchResult[][] = [];

  const gender = queryPlan.constraints.gender ?? body.gender ?? null;

  // Visual intents fire the creative-video lane (uses the same Marengo 3.0
  // embedding the products/looks dense lane uses, since product_creative.embedding
  // is also Marengo-encoded video). Cross-modal text→video matching is exactly
  // what Marengo was designed for, so for these intents the visual lane often
  // surfaces results the text lane misses.
  const VISUAL_INTENTS: SearchIntent[] = ['outfit_pairing', 'occasion_lookup', 'lookalike', 'vibe_browse'];
  const useVisualLane = VISUAL_INTENTS.includes(queryPlan.intent);

  if (allEmbeddings.length > 0) {
    const retrievalCalls = allEmbeddings.flatMap(emb => {
      const pgVec = toPgVector(emb);
      return [
        admin.rpc('search_products_hybrid', {
          query_embedding: pgVec,
          query_text: query,
          k,
          filter_gender: gender,
          filter_type: null,
        }),
        admin.rpc('search_looks_hybrid', {
          query_embedding: pgVec,
          query_text: query,
          k: Math.ceil(k * 0.6),
        }),
      ];
    });

    // Visual lane: 512-dim TwelveLabs embedding against product_creative video embeddings.
    // Uses separate visualEmbedding (not rawEmbedding which is now OpenAI 1536-dim).
    if (useVisualLane && visualEmbedding) {
      retrievalCalls.push(
        admin.rpc('search_creatives_visual', {
          query_embedding: toPgVector(visualEmbedding),
          k: Math.ceil(k * 0.5),
          filter_gender: gender,
        })
      );
    }

    const results = await Promise.all(retrievalCalls);

    // The first allEmbeddings.length * 2 are product/look pairs; if visual lane
    // is on, the trailing call is creatives → product set.
    const pairCount = allEmbeddings.length * 2;
    results.forEach((res, i) => {
      const rows = (res.data ?? []) as SearchResult[];
      if (i < pairCount) {
        if (i % 2 === 0) productSets.push(rows);
        else             lookSets.push(rows);
      } else {
        // Visual creative results — map into product surface (each row is a product)
        productSets.push(rows);
      }
    });
  } else {
    // No embeddings → BM25-only fallback: call with a zero vector stub that
    // the RPC degrades gracefully from (dense path finds nothing, BM25 works).
    const zeroVec = toPgVector(new Array(1536).fill(0));
    const [prodRes, looksRes] = await Promise.all([
      admin.rpc('search_products_hybrid', { query_embedding: zeroVec, query_text: query, k, filter_gender: gender, filter_type: null }),
      admin.rpc('search_looks_hybrid',    { query_embedding: zeroVec, query_text: query, k: Math.ceil(k * 0.6) }),
    ]);
    if (prodRes.data?.length)  productSets.push(prodRes.data as SearchResult[]);
    if (looksRes.data?.length) lookSets.push(looksRes.data as SearchResult[]);
  }

  // ── Step 4: RRF fusion across sets, then compose by result_shape ─────────
  const fusedProducts = rrfFuse(productSets, k);
  const fusedLooks    = rrfFuse(lookSets,    Math.ceil(k * 0.6));

  // ── Step 5: Graph augment for outfit_pairing intent ───────────────────────
  if (queryPlan.intent === 'outfit_pairing' && fusedProducts.length > 0) {
    const anchorId = fusedProducts[0].id;
    const { data: graphRows } = await admin.rpc('search_products_by_entity_edges', {
      anchor_id:        anchorId,
      anchor_type:      'product',
      k:                Math.ceil(k * 0.5),
      edge_type_filter: 'pairs_with',
    });
    if (graphRows?.length) {
      // Prepend graph neighbours with high prior before the fused set
      const graphSet = (graphRows as SearchResult[]).map(r => ({ ...r, score: r.edge_weight ?? 0.8 }));
      fusedProducts.unshift(...graphSet.slice(0, 4));
    }
  }

  // ── Build final result list ───────────────────────────────────────────────
  const results: SearchResult[] = [];
  for (const surface of queryPlan.result_shape) {
    if (surface === 'products')  results.push(...fusedProducts);
    else if (surface === 'looks') results.push(...fusedLooks);
    // 'creatives' surface is handled client-side via product_creative join
  }
  // Deduplicate by id (a product might appear in both products + looks passes)
  const seen = new Set<string>();
  const dedupedResults = results.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  // ── Step 6: Log query ─────────────────────────────────────────────────────
  const topScore = dedupedResults[0]?.score ?? null;
  const resultCount = dedupedResults.length;

  let queryId: string | null = null;
  if (serviceKey) {
    const { data: logData } = await admin.rpc('log_search_query', {
      p_raw_query:    query,
      p_result_count: resultCount,
      p_top_score:    topScore,
      p_query_plan:   queryPlan as unknown as Record<string, unknown>,
      p_user_id:      user_id ?? null,
      p_session_id:   session_id ?? null,
    });
    queryId = logData ?? null;
  }

  // Cold miss: very few results or very low score → backfill agent will pick up
  const coldMiss = resultCount < 5 || topScore === null || topScore < 0.020;

  return jsonRes({
    ok: true,
    results: dedupedResults,
    query_plan: queryPlan,
    cold_miss: coldMiss,
    query_id: queryId,
    meta: {
      result_count: resultCount,
      top_score:    topScore,
      embeddings_used: allEmbeddings.length,
      rewrites_used:   rewriteEmbeddings.length,
    },
  });
});
