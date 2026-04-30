// nl-search — Natural-language search orchestrator (creative-first).
//
// Two-branch pipeline:
//
//   ┌────────────────────────────────────────────────────────────────────┐
//   │ analyzeQuery(query) → { kind: 'typed' | 'pairing' | 'vibe', ... }  │
//   └────────────────────────────────────────────────────────────────────┘
//                                  │
//          ┌───────────────────────┴───────────────────────┐
//          ▼                                               ▼
//  ┌──────────────────────┐                   ┌─────────────────────────┐
//  │ FAST (typed/pairing) │                   │ SLOW (vibe fallback)    │
//  │  • Cached OpenAI emb │                   │  • Claude QueryPlan     │
//  │  • ONE hybrid RPC    │                   │  • OpenAI emb + rewrites│
//  │    with filter_types │                   │  • TwelveLabs Marengo   │
//  │  • Skip Claude/Marengo│                  │  • search_creatives_*   │
//  │  • Skip rewrites      │                  │  • RRF fuse all sets    │
//  │  • ~80–250ms          │                  │  • ~700–1500ms          │
//  └──────────────────────┘                   └─────────────────────────┘
//
// The fast branch fires for ~95% of queries ("shoes", "white sneakers",
// "summer dress", "what to wear with jeans") and guarantees results stay
// inside the resolved catalog type set — no LMNT drinks for "shoes".
//
// The slow branch is the original Claude+OpenAI+TwelveLabs pipeline, kept
// for genuine aesthetic queries ("quiet luxury", "Y2K", "coastal grandmother")
// where catalog-noun matching can't help.
//
// Required secrets:
//   ANTHROPIC_API_KEY   — Claude Haiku (vibe-branch QueryPlan)
//   OPENAI_API_KEY      — text-embedding-3-small (1536-dim, both branches)
//   TWELVELABS_API_KEY  — Marengo 3.0 (512-dim, vibe branch only)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { analyzeQuery, bm25TextFor } from './query-analyzer.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

// Hard timeouts for the vibe branch — Marengo cold starts and Claude API
// tail latency can stall multi-second responses, and they're tiebreakers
// at best. Better to fall back to the OpenAI+BM25 lanes than block.
const TWELVELABS_TIMEOUT_MS = 600;
const CLAUDE_TIMEOUT_MS = 700;

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
  anchor_name?: string;
  // Set so consumers + logs can see which branch produced the results.
  branch?: 'typed' | 'pairing' | 'vibe';
  resolved_types?: string[];
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

// ── Claude: QueryPlan generation (vibe branch only) ──────────────────────────

async function buildQueryPlan(query: string, anthropicKey: string): Promise<QueryPlan> {
  const prompt = `You are a fashion search query planner. Analyze the user's query and output a JSON QueryPlan.

Query: "${query}"

Output a JSON object with these exact fields:
- "intent": one of ["outfit_pairing","occasion_lookup","product_find","vibe_browse","lookalike","ambiguous"]
- "rewrites": array of 2 alternative phrasings of the same query that would help a search engine find the right items. Be specific and concrete.
- "constraints": object with optional keys: "gender" (men|women|unisex), "occasion" (string), "price_band" (budget|mid|luxury)
- "result_shape": ordered array of surfaces to fill. Example: ["looks","products"] or ["products","looks"]
- "anchor_name": ONLY if intent=outfit_pairing.

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
  plan.intent       = plan.intent       ?? 'ambiguous';
  plan.rewrites     = plan.rewrites     ?? [];
  plan.constraints  = plan.constraints  ?? {};
  plan.result_shape = plan.result_shape ?? ['products', 'looks'];
  return plan;
}

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

// ── Query-embedding cache ────────────────────────────────────────────────────

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

async function embedTextCached(
  query: string,
  openaiKey: string,
  admin: ReturnType<typeof createClient>,
): Promise<{ embedding: number[]; cacheHit: boolean }> {
  const key = normalizeQueryForCache(query);

  try {
    const { data } = await admin
      .from('query_embeddings')
      .select('embedding')
      .eq('query_text', key)
      .maybeSingle();
    const cached = parsePgVector((data as { embedding?: unknown } | null)?.embedding);
    if (cached) {
      admin.rpc('touch_query_embedding', { p_query_text: key }).then(() => {});
      return { embedding: cached, cacheHit: true };
    }
  } catch {
    // Cache lookup failure is non-fatal — fall through to live embed.
  }

  const embedding = await embedTextOpenAI(query, openaiKey);
  admin
    .from('query_embeddings')
    .insert({ query_text: key, embedding: toPgVector(embedding) })
    .then(() => {});
  return { embedding, cacheHit: false };
}

// ── TwelveLabs: text→video embedding (vibe branch only) ─────────────────────

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

function normaliseHybridRows(rows: Array<Record<string, unknown>>): SearchResult[] {
  return rows.map(r => ({
    ...r,
    entity_type: 'creative' as const,
    score: 0,
  })) as unknown as SearchResult[];
}

// ── RRF fusion across multiple retrieval sets ─────────────────────────────────

function rrfFuse(
  sets: Array<Array<SearchResult>>,
  topK: number
): SearchResult[] {
  const scoreMap = new Map<string, { item: SearchResult; score: number }>();

  for (const set of sets) {
    set.forEach((item, idx) => {
      const rank = idx + 1;
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
  const excludeIds = Array.isArray(body.exclude_ids)
    ? body.exclude_ids.filter((s): s is string => typeof s === 'string').slice(0, 500)
    : [];

  if (!query?.trim()) return jsonRes({ ok: false, error: 'query required' }, 400);

  const admin = createClient(supabaseUrl, serviceKey);
  const analysis = analyzeQuery(query);
  const gender = body.gender ?? null;

  // ─────────────────────────────────────────────────────────────────────────
  // FAST BRANCH — typed or pairing query.
  //
  //   • analyzer resolved the catalog type set
  //   • dense lane: cached OpenAI embedding (~5–10 ms hit, ~150 ms miss)
  //   • BM25 lane: stripped query (catalog noun removed) so within-type
  //     ranking is driven by modifiers ("white", "summer", brand names…)
  //   • single hybrid RPC enforces filter_types — results CANNOT bleed
  //     into other categories
  //
  // No Claude, no Marengo, no rewrites — typically 80–250 ms total.
  // ─────────────────────────────────────────────────────────────────────────
  if (analysis.kind === 'typed' || analysis.kind === 'pairing') {
    const filterTypes = analysis.kind === 'typed' ? analysis.types : analysis.pair_types;
    const bm25Text = bm25TextFor(analysis, query);

    let embedding: number[] | null = null;
    let cacheHit = false;
    if (openaiKey) {
      try {
        const r = await embedTextCached(query, openaiKey, admin);
        embedding = r.embedding;
        cacheHit = r.cacheHit;
      } catch (err) {
        console.warn('[nl-search] fast-branch embed failed, BM25-only fallback:', err);
      }
    }

    // If embedding is unavailable we still issue the RPC with a zero vector
    // so the BM25 lane carries the full ranking. Type filter + BM25 alone
    // produces useful category-browse results.
    const queryEmbedding = embedding ?? new Array(1536).fill(0);

    const res = await admin.rpc('search_creatives_hybrid', {
      query_embedding: toPgVector(queryEmbedding),
      query_text:      bm25Text,
      k,
      filter_gender:   gender,
      filter_types:    filterTypes,
      require_elite:   false,
      exclude_ids:     excludeIds,
    });

    if (res.error) {
      console.error('[nl-search] fast-branch RPC error:', res.error);
      return jsonRes({ ok: false, error: 'search_failed', detail: res.error.message }, 500);
    }

    const rows = (res.data ?? []) as Array<Record<string, unknown>>;
    const fusedCreatives = normaliseHybridRows(rows);

    // The DB ranks per-creative; we still dedupe by product_id so a single
    // product with multiple live creatives doesn't stack the grid.
    const seenProductIds = new Set<string>();
    const dedupedResults: SearchResult[] = [];
    for (const c of fusedCreatives) {
      if (c.product_id && seenProductIds.has(c.product_id)) continue;
      if (c.product_id) seenProductIds.add(c.product_id);
      dedupedResults.push({ ...c, score: c.rrf_score ?? 0 });
    }

    const queryPlan: QueryPlan = {
      intent: analysis.kind === 'pairing' ? 'outfit_pairing' : 'product_find',
      rewrites: [],
      constraints: { gender: gender ?? undefined },
      result_shape: ['products', 'looks'],
      anchor_name: analysis.kind === 'pairing' ? analysis.anchor : undefined,
      branch: analysis.kind,
      resolved_types: filterTypes,
    };

    const topScore = dedupedResults[0]?.score ?? null;
    const resultCount = dedupedResults.length;

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
      cold_miss: resultCount < 5,
      query_id: logData ?? null,
      meta: {
        result_count: resultCount,
        top_score:    topScore,
        branch:       analysis.kind,
        resolved_types: filterTypes,
        bm25_text:    bm25Text,
        embedding_cache_hit: cacheHit,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SLOW BRANCH — vibe / aesthetic query (no catalog noun detected).
  //
  // Original Claude+OpenAI+TwelveLabs pipeline with hard timeouts.
  // ─────────────────────────────────────────────────────────────────────────

  const planWithTimeout = anthropicKey
    ? Promise.race([
        buildQueryPlan(query, anthropicKey),
        new Promise<QueryPlan>(resolve =>
          setTimeout(() => resolve(heuristicQueryPlan(query)), CLAUDE_TIMEOUT_MS)
        ),
      ])
    : Promise.resolve(heuristicQueryPlan(query));

  const visualWithTimeout: Promise<number[] | null> = twelveLabsKey
    ? Promise.race([
        embedTextTwelveLabs(query, twelveLabsKey),
        new Promise<number[] | null>(resolve =>
          setTimeout(() => resolve(null), TWELVELABS_TIMEOUT_MS)
        ),
      ])
    : Promise.resolve(null);

  const [planResult, rawEmbedResult, visualResult] = await Promise.allSettled([
    planWithTimeout,
    openaiKey    ? embedTextCached(query, openaiKey, admin)        : Promise.reject(new Error('no OPENAI_API_KEY')),
    visualWithTimeout,
  ]);

  const queryPlan: QueryPlan = planResult.status === 'fulfilled'
    ? planResult.value
    : heuristicQueryPlan(query);
  queryPlan.branch = 'vibe';

  const canEmbed = rawEmbedResult.status === 'fulfilled';
  const rawEmbedding = canEmbed ? rawEmbedResult.value.embedding : null;
  if (canEmbed && rawEmbedResult.value.cacheHit) {
    console.log(`[nl-search] embedding cache hit for "${normalizeQueryForCache(query)}"`);
  }

  let rewriteEmbeddings: number[][] = [];
  if (canEmbed && openaiKey && queryPlan.rewrites.length > 0) {
    const rewriteResults = await Promise.allSettled(
      queryPlan.rewrites.slice(0, 2).map(r => embedTextOpenAI(r, openaiKey))
    );
    rewriteEmbeddings = rewriteResults
      .filter((r): r is PromiseFulfilledResult<number[]> => r.status === 'fulfilled')
      .map(r => r.value);
  }

  const visualEmbedding: number[] | null =
    visualResult.status === 'fulfilled' ? visualResult.value : null;

  const allEmbeddings: number[][] = [
    ...(rawEmbedding ? [rawEmbedding] : []),
    ...rewriteEmbeddings,
  ];

  const vibeGender = queryPlan.constraints.gender ?? gender ?? null;
  const creativeSets: SearchResult[][] = [];

  if (allEmbeddings.length > 0) {
    const retrievalCalls = allEmbeddings.map(emb =>
      admin.rpc('search_creatives_hybrid', {
        query_embedding: toPgVector(emb),
        query_text:      query,
        k,
        filter_gender:   vibeGender,
        filter_types:    null,
        require_elite:   false,
        exclude_ids:     excludeIds,
      })
    );

    if (visualEmbedding) {
      retrievalCalls.push(
        admin.rpc('search_creatives_visual', {
          query_embedding: toPgVector(visualEmbedding),
          k:               Math.ceil(k * 0.5),
          filter_gender:   vibeGender,
        })
      );
    }

    const results = await Promise.all(retrievalCalls);

    results.forEach((res: { data?: unknown }, i: number) => {
      const rows = (res.data ?? []) as Array<Record<string, unknown>>;
      if (rows.length === 0) return;

      const isVisualLane = visualEmbedding != null && i === retrievalCalls.length - 1;
      if (isVisualLane) {
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
        creativeSets.push(normaliseHybridRows(rows));
      }
    });
  } else {
    const zeroVec = toPgVector(new Array(1536).fill(0));
    const res = await admin.rpc('search_creatives_hybrid', {
      query_embedding: zeroVec,
      query_text:      query,
      k,
      filter_gender:   vibeGender,
      filter_types:    null,
      require_elite:   false,
      exclude_ids:     excludeIds,
    });
    if (res.data?.length) {
      creativeSets.push(normaliseHybridRows(res.data as Array<Record<string, unknown>>));
    }
  }

  let fusedCreatives = rrfFuse(creativeSets, k);

  // Outfit-intent guard preserved from the original pipeline.
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

  const seenProductIds = new Set<string>();
  const dedupedResults: SearchResult[] = [];
  for (const c of fusedCreatives) {
    if (c.product_id && seenProductIds.has(c.product_id)) continue;
    if (c.product_id) seenProductIds.add(c.product_id);
    dedupedResults.push(c);
  }

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
      branch:       'vibe',
      embeddings_used: allEmbeddings.length,
      rewrites_used:   rewriteEmbeddings.length,
      visual_lane:     visualEmbedding != null,
    },
  });
});
