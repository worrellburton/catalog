// nl-search — Natural-language search orchestrator (creative-first).
//
// Pipeline:
//   1. QueryPlan via Claude Haiku            — classify intent, generate rewrites, extract constraints
//   2. Embed query + rewrites                — OpenAI text-embedding-3-small (1536-dim, text lanes), parallel
//      └─ plus TwelveLabs Marengo 3.0 (512-dim) for the visual creative lane
//   3. Hybrid retrieval                      — search_creatives_hybrid (text + BM25) and search_creatives_visual
//   4. RRF fusion                            — merge all retrieval sets into one ranked list
//   5. Outfit-intent guard                   — strip accessory/underwear false positives from outfit/look queries
//   6. Dedupe by product_id                  — prevent one product stacking the grid
//   7. Log query                             — log_search_query RPC, return cold_miss flag
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

  let body: { query?: string; k?: number; gender?: string; session_id?: string; user_id?: string; exclude_ids?: string[] };
  try { body = await req.json(); } catch { return jsonRes({ ok: false, error: 'Invalid JSON' }, 400); }

  const { query, session_id, user_id } = body;
  const k = Math.min(Math.max(body.k ?? 24, 5), 60);
  // Pagination: caller passes the IDs already shown so the DB can return
  // truly fresh results instead of forcing a client-side dedupe of overlap.
  const excludeIds = Array.isArray(body.exclude_ids)
    ? body.exclude_ids.filter((s): s is string => typeof s === 'string').slice(0, 500)
    : [];

  if (!query?.trim()) return jsonRes({ ok: false, error: 'query required' }, 400);

  const admin = createClient(supabaseUrl, serviceKey);

  // ── Step 1+2+TwelveLabs (all parallel): QueryPlan + raw embed + visual embed ─
  //
  // Performance notes:
  // • Claude Haiku gets a 700 ms hard cap — if it hasn't replied by then we
  //   fall back to the heuristic plan immediately.  This prevents a cold-start
  //   Anthropic round-trip from blocking the whole search pipeline.
  // • TwelveLabs (512-dim visual lane) is now kicked off at the same time as
  //   Claude and OpenAI instead of serially after them, saving ~300–600 ms.
  const planWithTimeout = anthropicKey
    ? Promise.race([
        buildQueryPlan(query, anthropicKey),
        new Promise<QueryPlan>(resolve =>
          setTimeout(() => resolve(heuristicQueryPlan(query)), 700)
        ),
      ])
    : Promise.resolve(heuristicQueryPlan(query));

  const [planResult, rawEmbedResult, visualResult] = await Promise.allSettled([
    planWithTimeout,
    openaiKey    ? embedTextOpenAI(query, openaiKey)              : Promise.reject(new Error('no OPENAI_API_KEY')),
    twelveLabsKey ? embedTextTwelveLabs(query, twelveLabsKey)     : Promise.reject(new Error('no TWELVELABS_API_KEY')),
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

  // Visual embedding resolved in parallel above (phase 1).
  const visualEmbedding: number[] | null =
    visualResult.status === 'fulfilled' ? visualResult.value : null;

  const allEmbeddings: number[][] = [
    ...(rawEmbedding ? [rawEmbedding] : []),
    ...rewriteEmbeddings,
  ];

  // ── Step 3: Hybrid retrieval over CREATIVES (parallel across embeddings) ──
  // The consumer feed only renders creatives, so we query product_creative
  // directly via search_creatives_hybrid. Each creative carries its joined
  // product fields in the result row, so the client doesn't need to hydrate
  // through products → look_products → product_creative.
  const creativeSets: SearchResult[][] = [];

  const gender = queryPlan.constraints.gender ?? body.gender ?? null;

  if (allEmbeddings.length > 0) {
    const retrievalCalls = allEmbeddings.map(emb =>
      admin.rpc('search_creatives_hybrid', {
        query_embedding: toPgVector(emb),
        query_text:      query,
        k,
        filter_gender:   gender,
        filter_type:     null,
        require_elite:   false,
        exclude_ids:     excludeIds,
      })
    );

    // Visual lane: 512-dim TwelveLabs embedding against product_creative.embedding.
    // The visual RPC returns a product-shaped row, so we normalise it into
    // CreativeRow shape before fusion so RRF treats every set on equal footing.
    if (visualEmbedding) {
      retrievalCalls.push(
        admin.rpc('search_creatives_visual', {
          query_embedding: toPgVector(visualEmbedding),
          k:               Math.ceil(k * 0.5),
          filter_gender:   gender,
        })
      );
    }

    const results = await Promise.all(retrievalCalls);

    results.forEach((res: { data?: unknown }, i: number) => {
      const rows = (res.data ?? []) as Array<Record<string, unknown>>;
      if (rows.length === 0) return;

      const isVisualLane = visualEmbedding != null && i === retrievalCalls.length - 1;
      if (isVisualLane) {
        // visual RPC row → normalise into CreativeRow shape
        const normalised: SearchResult[] = rows.map(r => ({
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
        creativeSets.push(normalised);
      } else {
        // text-lane: the RPC result has all CreativeRow fields EXCEPT entity_type
        // (Postgres doesn't emit a literal column for it). Inject it so the
        // client-side type guard `r.entity_type === 'creative'` works.
        const normalised = (rows as Array<Record<string, unknown>>).map(r => ({
          ...r,
          entity_type: 'creative' as const,
          score: 0,
        })) as unknown as SearchResult[];
        creativeSets.push(normalised);
      }
    });
  } else {
    // No embeddings → BM25-only fallback via the hybrid RPC with a zero vector.
    const zeroVec = toPgVector(new Array(1536).fill(0));
    const res = await admin.rpc('search_creatives_hybrid', {
      query_embedding: zeroVec,
      query_text:      query,
      k,
      filter_gender:   gender,
      filter_type:     null,
      require_elite:   false,
      exclude_ids:     excludeIds,
    });
    if (res.data?.length) {
      const normalised = (res.data as Array<Record<string, unknown>>).map(r => ({
        ...r,
        entity_type: 'creative' as const,
        score: 0,
      })) as unknown as SearchResult[];
      creativeSets.push(normalised);
    }
  }

  // ── Step 4: RRF fusion across all creative sets ──────────────────────────
  let fusedCreatives = rrfFuse(creativeSets, k);

  // ── Step 4b: Outfit-intent guard ────────────────────────────────────────
  // When the user is shopping for an outfit/look/vibe, accessories and
  // underwear are almost never the headline answer — they're sub-pieces.
  // Strip them unless the query explicitly asks for them, otherwise a
  // bra concept_doc that mentions "summer" can outrank actual summer dresses.
  const intent = queryPlan.intent;
  const isOutfitIntent = (intent === 'occasion_lookup' || intent === 'vibe_browse' || intent === 'outfit_pairing')
    && /\b(outfit|look|fit|wear|style|ensemble|set)\b/i.test(query);
  if (isOutfitIntent) {
    const explicitlyAsks = /\b(underwear|bra|panties|lingerie|brief|boxer|thong|swimsuit|bikini|trunks|accessor|jewell?ery|necklace|earrings?|bracelet|watch|hat|cap|beanie|scarf|belt|bag|sunglass|sock)\b/i.test(query);
    if (!explicitlyAsks) {
      const blocked = new Set(['underwear', 'lingerie', 'accessories', 'jewellery', 'jewelry', 'socks', 'hosiery']);
      fusedCreatives = fusedCreatives.filter(c => {
        const t = (c.product_type ?? '').toLowerCase();
        return !blocked.has(t);
      });
    }
  }

  // ── Step 5: Dedupe by product_id so one product can't dominate the grid ──
  // (a product with multiple live creatives would otherwise stack).
  const seenProductIds = new Set<string>();
  const dedupedResults: SearchResult[] = [];
  for (const c of fusedCreatives) {
    if (c.product_id && seenProductIds.has(c.product_id)) continue;
    if (c.product_id) seenProductIds.add(c.product_id);
    dedupedResults.push(c);
  }

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
      visual_lane:     visualEmbedding != null,
    },
  });
});
