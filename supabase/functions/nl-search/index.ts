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
// SEARCH_V3: lowered 1800→900 to hit <2s cold-miss target. Haiku
// typically responds in 800-1200ms; at 900ms we catch ~85% of responses
// and the (now-fixed Phase A) static fallback handles the rest cleanly.
const HAIKU_TIMEOUT_MS      = 900;
const TWELVELABS_TIMEOUT_MS = 600;

// Cache invalidation knobs. Bump either constant to expire all cached
// query_embeddings rows that were generated under the old version. The DB
// holds embedding_v / expansion_v columns alongside expires_at; rows are
// only treated as a hit when both versions match AND expires_at is in the
// future. Default TTL is 30 days from write.
const EMBED_V        = 1;
const EXPANSION_V    = 5;  // SEARCH_V3 Phase A: synonym map fix invalidates v4
// Daily cache refresh: keeps repeat searches under <1s but ensures users
// see freshly-ingested products without waiting 30 days for cache rollover.
const CACHE_TTL_DAYS = 1;

// When the creative pool returns < this many results, fan out to the
// products lane so we don't ship a near-empty grid back to the user.
// SEARCH_V3: lowered 8→3. At current catalog size (≤9 creatives per type)
// the old threshold soft-relaxed on every type-filtered query and padded
// with unrelated junk.
const MIN_RESULTS_THRESHOLD = 3;
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
  'Fragrance', 'Skincare', 'Haircare', 'Makeup', 'Decor', 'Book', 'Yoga',
];

// Taxonomy: dynamic Haiku examples loaded from product_taxonomy table.
// Refreshed every 5 min alongside canonical types.  Fails gracefully
// when the table doesn't exist yet (pre-migration).
interface TaxonomyRow { type: string; category: string | null; synonyms: string[] | null; keywords: string | null; }
let TAXONOMY_CACHE: { examples: string; loaded_at: number } | null = null;

async function loadTaxonomyExamples(admin: ReturnType<typeof createClient>): Promise<string> {
  const now = Date.now();
  if (TAXONOMY_CACHE && now - TAXONOMY_CACHE.loaded_at < CANONICAL_TYPES_TTL_MS) {
    return TAXONOMY_CACHE.examples;
  }
  try {
    const { data, error } = await admin
      .from('product_taxonomy')
      .select('type, category, synonyms, keywords')
      .not('synonyms', 'is', null);
    if (error) throw error;
    const rows = (data ?? []) as TaxonomyRow[];
    // Build one few-shot example per type using its first synonym as the
    // "user typed" query — teaches Haiku that synonym → canonical type.
    const lines = rows
      .filter(r => r.synonyms && r.synonyms.length > 0)
      .map(r => {
        const syn = r.synonyms![0];
        const kw  = r.keywords ?? '';
        return `"${syn}" → {"intent":"browse","types":["${r.type}"],"anchor_type":null,"pair_types":null,"keywords":"${kw}"}`;
      });
    const examples = lines.join('\n');
    TAXONOMY_CACHE = { examples, loaded_at: now };
    return examples;
  } catch {
    // Table may not exist yet — return last cached value or empty string.
    return TAXONOMY_CACHE?.examples ?? '';
  }
}

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ── Fashion gate for visual (TwelveLabs Marengo) lane ────────────────────────
// Marengo is trained on fashion imagery — it helps for outfit/pairing/vibe
// queries but actively hurts for non-fashion categories (candles, toothbrush,
// skincare) by pulling visually similar but semantically wrong results.
const FASHION_TYPES = new Set([
  'Top', 'Jacket', 'Pants', 'Shorts', 'Skirt', 'Dress', 'Coat',
  'Activewear', 'Loungewear', 'Underwear', 'Swimwear',
  'Sneakers', 'Boots', 'Sandals', 'Heels', 'Loafers', 'Flats', 'Mules',
  'Hat', 'Bag', 'Scarf', 'Socks',
]);

function isFashionQuery(intent: 'browse' | 'pairing' | 'vibe', types: string[] | null): boolean {
  if (intent === 'vibe' || intent === 'pairing') return true;
  if (!types || types.length === 0) return false;
  return types.some(t => FASHION_TYPES.has(t));
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
  // ── Phase 4: structured constraints ─────────────────────────────────────
  // Lowercased, deduped tokens used to enrich the BM25 query and (when
  // present) bias re-ranking. These are extracted by Haiku and gracefully
  // empty when absent.
  /** Occasions the user is shopping for ("date night", "wedding guest", "work", "gym"). */
  occasions: string[];
  /** Seasons / weather ("summer", "winter", "rainy", "warm weather"). */
  seasons: string[];
  /** Colour terms ("black", "navy", "earth tones"). */
  colors: string[];
  /** Materials / fabrics ("denim", "cashmere", "leather", "silk"). */
  materials: string[];
  /** Style descriptors ("minimal", "streetwear", "y2k", "coastal grandmother"). */
  styles: string[];
  /** Maximum price the user is willing to pay (USD). null when unconstrained. */
  price_max: number | null;
}

interface CreativeRow {
  id: string;
  entity_type: 'creative';
  product_id: string;
  // SEARCH_V3: creative_id is null when this is a placeholder product row
  // (no live creative exists yet — client renders an image card).
  creative_id: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  affiliate_url: string | null;
  duration_seconds: number | null;
  is_elite: boolean | null;
  is_placeholder: boolean;
  product_name: string | null;
  product_brand: string | null;
  product_price: string | null;
  product_image_url: string | null;
  product_url: string | null;
  product_gender: string | null;
  product_type: string | null;
  concept_doc: string | null;
  concept_facets: Record<string, unknown> | null;
  facet_text: string | null;
  rrf_score: number;
  dense_rank: number | null;
  bm25_rank:  number | null;
  type_match?: boolean | null;
}

/**
 * NOTE on looks lane (Phase 1): looks-matched results are projected as
 * product-shaped rows by `search_looks_to_products` so the existing client
 * pipeline + SearchResult union stay unchanged. The original look context
 * (look_id, look_title) is dropped at the boundary today; if/when the
 * client needs it, surface it via additional optional fields here and on
 * the RPC return shape.
 */
type SearchResult = CreativeRow & { score: number };

// ── Claude Haiku: query expansion ────────────────────────────────────────────

async function expandQueryWithHaiku(
  query: string,
  anthropicKey: string,
  canonicalTypes: string[],
  taxonomyExamples = '',
): Promise<QueryExpansion> {
  const typeList = canonicalTypes.join(', ');
  const dynamicExamples = taxonomyExamples ? `\n${taxonomyExamples}` : '';
  const prompt = `You are a multi-category catalog search planner. The catalog spans fashion AND non-fashion (beauty, home, tech, lifestyle). It contains these exact product types:
${typeList}

User query: "${query}"

Decide intent and return ONLY a JSON object with these exact fields:
- "intent": "browse" if the user is shopping a category | "pairing" if they want what to wear with something they have | "vibe" if it's an abstract aesthetic / mood with no specific category
- "types": array of product types from the list above. Pick the closest canonical type — use "Haircare" for hair products, "Decor" for candles/home decor, "Fragrance" for perfume/cologne. For broad fashion terms include adjacent types (e.g. "pants" → ["Pants","Shorts","Activewear"], "shoes" → ["Sneakers","Boots","Sandals","Heels","Loafers","Flats","Mules"]). For specific terms narrow it. Empty array when intent is "pairing" or "vibe". If nothing matches, return empty array.
- "anchor_type": for intent=pairing only, the type of the anchor item. null otherwise.
- "pair_types": for intent=pairing only, the complementary types to surface (NOT the anchor). null otherwise.
- "keywords": the query stripped of the category noun, plus 1-3 catalog synonyms so BM25 can hit products whose copy uses different words. Examples: "cologne" → "cologne fragrance perfume scent", "sweater" → "sweater pullover knit crewneck", "sneakers" → "sneakers shoe runner trainer", "leggings" → "leggings legging tights pant", "candle" → "candle scented wax", "lipstick" → "lipstick lip lipgloss balm". For non-synonym queries (specific product names, brands, vibes), return the keywords without padding.
- "occasions": array of occasion phrases the user implied ("date night", "wedding guest", "work", "gym", "going out"). Lowercase, max 4. Empty array if none.
- "seasons": array of season / weather terms ("summer", "winter", "spring", "fall", "rainy", "hot weather", "cold weather"). Lowercase, max 3. Empty array if none.
- "colors": array of colour terms mentioned ("black", "navy", "cream", "earth tones"). Lowercase, max 4. Empty array if none.
- "materials": array of material / fabric terms ("denim", "cashmere", "leather", "silk", "cotton"). Lowercase, max 4. Empty array if none.
- "styles": array of style / aesthetic descriptors ("minimal", "streetwear", "y2k", "quiet luxury", "coastal grandmother"). Lowercase, max 4. Empty array if none.
- "price_max": numeric max price in USD if the query mentions a budget ("under $50", "less than 100"); null otherwise.

Examples:
"pants"                          → {"intent":"browse","types":["Pants","Shorts","Activewear"],"anchor_type":null,"pair_types":null,"keywords":"","occasions":[],"seasons":[],"colors":[],"materials":[],"styles":[],"price_max":null}
"hair cream"                     → {"intent":"browse","types":["Haircare"],"anchor_type":null,"pair_types":null,"keywords":"hair cream pomade styling","occasions":[],"seasons":[],"colors":[],"materials":[],"styles":[],"price_max":null}
"candles"                        → {"intent":"browse","types":["Decor"],"anchor_type":null,"pair_types":null,"keywords":"candle scented wax","occasions":[],"seasons":[],"colors":[],"materials":[],"styles":[],"price_max":null}
"toothbrush"                     → {"intent":"browse","types":[],"anchor_type":null,"pair_types":null,"keywords":"toothbrush dental","occasions":[],"seasons":[],"colors":[],"materials":[],"styles":[],"price_max":null}
"white sneakers"                 → {"intent":"browse","types":["Sneakers"],"anchor_type":null,"pair_types":null,"keywords":"white sneaker shoe runner","occasions":[],"seasons":[],"colors":["white"],"materials":[],"styles":[],"price_max":null}
"cologne"                        → {"intent":"browse","types":["Fragrance"],"anchor_type":null,"pair_types":null,"keywords":"cologne fragrance perfume scent","occasions":[],"seasons":[],"colors":[],"materials":[],"styles":[],"price_max":null}
"cashmere sweater"               → {"intent":"browse","types":["Top"],"anchor_type":null,"pair_types":null,"keywords":"cashmere sweater pullover knit","occasions":[],"seasons":["winter"],"colors":[],"materials":["cashmere"],"styles":[],"price_max":null}
"black jeans combination"        → {"intent":"pairing","types":[],"anchor_type":"Pants","pair_types":["Top","Jacket","Sneakers"],"keywords":"black jeans","occasions":[],"seasons":[],"colors":["black"],"materials":["denim"],"styles":[],"price_max":null}
"date night outfit"              → {"intent":"vibe","types":[],"anchor_type":null,"pair_types":null,"keywords":"date night outfit","occasions":["date night"],"seasons":[],"colors":[],"materials":[],"styles":[],"price_max":null}
"summer outfit"                  → {"intent":"vibe","types":[],"anchor_type":null,"pair_types":null,"keywords":"summer outfit","occasions":[],"seasons":["summer"],"colors":[],"materials":[],"styles":[],"price_max":null}
"best for summer"                → {"intent":"vibe","types":[],"anchor_type":null,"pair_types":null,"keywords":"summer warm weather","occasions":[],"seasons":["summer"],"colors":[],"materials":[],"styles":[],"price_max":null}
"party dress red"                → {"intent":"browse","types":["Dress"],"anchor_type":null,"pair_types":null,"keywords":"red party","occasions":["party"],"seasons":[],"colors":["red"],"materials":[],"styles":[],"price_max":null}
"quiet luxury"                   → {"intent":"vibe","types":[],"anchor_type":null,"pair_types":null,"keywords":"quiet luxury","occasions":[],"seasons":[],"colors":[],"materials":[],"styles":["quiet luxury"],"price_max":null}
"linen shirt under 80"           → {"intent":"browse","types":["Top"],"anchor_type":null,"pair_types":null,"keywords":"linen shirt","occasions":[],"seasons":["summer"],"colors":[],"materials":["linen"],"styles":[],"price_max":80}${dynamicExamples}

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
      max_tokens: 400,
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

  // Phase 4: normalise structured constraint arrays. Lowercase, dedupe,
  // strip empties, cap length so a runaway prompt can't dump hundreds.
  const normaliseTokenList = (xs: unknown, max: number): string[] => {
    if (!Array.isArray(xs)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of xs) {
      if (typeof v !== 'string') continue;
      const t = v.trim().toLowerCase();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= max) break;
    }
    return out;
  };
  const priceMaxRaw = (raw as { price_max?: unknown }).price_max;
  const price_max = typeof priceMaxRaw === 'number' && Number.isFinite(priceMaxRaw) && priceMaxRaw > 0
    ? priceMaxRaw
    : null;

  return {
    intent,
    types,
    anchor_type: intent === 'pairing' ? anchor_type : null,
    pair_types:  intent === 'pairing' && pair_types.length > 0 ? pair_types : null,
    keywords:    typeof raw.keywords === 'string' ? raw.keywords : query,
    occasions:   normaliseTokenList((raw as { occasions?: unknown }).occasions, 4),
    seasons:     normaliseTokenList((raw as { seasons?: unknown }).seasons, 3),
    colors:      normaliseTokenList((raw as { colors?: unknown }).colors, 4),
    materials:   normaliseTokenList((raw as { materials?: unknown }).materials, 4),
    styles:      normaliseTokenList((raw as { styles?: unknown }).styles, 4),
    price_max,
  };
}

/** Static-analyzer → expansion. Used as a hard-timeout fallback. */
function expansionFromStatic(query: string): QueryExpansion {
  const a = analyzeQuery(query);
  // Heuristic season / occasion extraction so the static fallback still
  // contributes some structured signal when Haiku times out.
  const lc = query.toLowerCase();
  const seasons = ['summer', 'winter', 'spring', 'fall', 'autumn'].filter(s => lc.includes(s));
  const OCCASION_TERMS = ['date night', 'wedding', 'work', 'gym', 'party', 'brunch', 'going out', 'travel'];
  const occasions = OCCASION_TERMS.filter(o => lc.includes(o));
  const empty = { occasions, seasons, colors: [], materials: [], styles: [], price_max: null };
  if (a.kind === 'pairing') {
    return { intent: 'pairing', types: [], anchor_type: null, pair_types: a.pair_types, keywords: a.keywords.join(' '), ...empty };
  }
  if (a.kind === 'typed') {
    return { intent: 'browse', types: a.types, anchor_type: null, pair_types: null, keywords: a.keywords.join(' '), ...empty };
  }
  return { intent: 'vibe', types: [], anchor_type: null, pair_types: null, keywords: query, ...empty };
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
    // Default placeholder/creative_id when the source RPC didn't supply
    // them (search_creatives_hybrid elite lane). Real values come straight
    // through from the new search_products_with_creatives RPC.
    creative_id:    (r.creative_id as string | null) ?? (r.id as string | null) ?? null,
    is_placeholder: r.is_placeholder === true || r.video_url == null,
    facet_text:     (r.facet_text as string | null) ?? null,
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
  // Load canonical types and taxonomy examples in parallel (both cached in module scope).
  const [canonicalTypes, taxonomyExamples] = await Promise.all([
    loadCanonicalTypes(admin),
    loadTaxonomyExamples(admin),
  ]);
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
          expandQueryWithHaiku(query, anthropicKey, canonicalTypes, taxonomyExamples)
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

  // TwelveLabs Marengo: launched in parallel with embed+haiku so it adds
  // zero net latency (Marengo ~200ms, well inside Haiku's 2500ms window).
  // The result is gated below by isFashionQuery — non-fashion queries
  // (candles, toothbrush, skincare) discard it to avoid visual drift.
  const visualTask: Promise<number[] | null> = twelveLabsKey
    ? Promise.race([
        embedTextTwelveLabs(query, twelveLabsKey).catch(err => {
          console.warn('[nl-search] marengo failed:', err);
          return null;
        }),
        new Promise<null>(resolve => setTimeout(() => resolve(null), TWELVELABS_TIMEOUT_MS)),
      ])
    : Promise.resolve(null);

  const [embedding, expansion, visualEmbeddingRaw] = await Promise.all([embedTask, expansionTask, visualTask]);

  // Gate visual lane to fashion/outfit/vibe queries only.
  const filterTypesForVisual = expansion.intent === 'pairing' ? expansion.pair_types : expansion.types;
  const visualEmbedding = isFashionQuery(expansion.intent, filterTypesForVisual) ? visualEmbeddingRaw : null;

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
  const baseBm25 = expansion.intent === 'vibe'
    ? query
    : (expansion.keywords?.trim() || query);

  // Phase 4: enrich BM25 query with structured constraints so they match
  // facet_text / concept_doc tokens at retrieval time. The terms repeat
  // across products in the right slice (e.g. all summer-coded items have
  // "summer" in facet_text), so adding them as plain query tokens raises
  // those rows in BM25 ranking without needing extra SQL params.
  const structuredTokens = [
    ...expansion.occasions,
    ...expansion.seasons,
    ...expansion.colors,
    ...expansion.materials,
    ...expansion.styles,
  ].filter(Boolean);
  // websearch_to_tsquery ANDs unquoted terms by default; with multi-word
  // synonym expansion (e.g. "cologne fragrance perfume scent") that means
  // a doc must contain ALL terms which kills BM25 entirely. OR-join every
  // token so any single match counts as a BM25 hit.
  const bm25Tokens = [
    ...baseBm25.split(/\s+/).filter(Boolean),
    ...structuredTokens,
  ];
  const bm25Text = bm25Tokens.length > 0
    ? bm25Tokens.join(' OR ')
    : (baseBm25 || query);

  // ── Step 4: hybrid SQL retrieval ─────────────────────────────────────────
  // SEARCH_V3: primary path is now `search_products_with_creatives`.
  // Every active product is searchable from day one — products without a
  // live creative arrive with `is_placeholder=true` and the client renders
  // an image card. This replaces the old creative-first +
  // products-fallback dance entirely.
  const queryEmbedding = embedding ?? new Array(1536).fill(0);
  const denseRpc = admin.rpc('search_products_with_creatives', {
    query_embedding:  toPgVector(queryEmbedding),
    query_text:       bm25Text,
    k,
    filter_gender:    gender,
    filter_types:     filterTypes,
    require_elite:    false,
    exclude_ids:      excludeIds,
  });

  // Elite boost lane: still query the creative index for premium creatives
  // and RRF-merge those into the top slots. Keeps the existing "boosted"
  // experience for elite-tagged content even though primary retrieval is
  // now product-first.
  const eliteRpc = admin.rpc('search_creatives_hybrid', {
    query_embedding:  toPgVector(queryEmbedding),
    query_text:       bm25Text,
    k:                Math.max(6, Math.ceil(k / 4)),
    filter_gender:    gender,
    filter_types:     filterTypes,
    require_elite:    true,
    exclude_ids:      excludeIds,
    min_results:      MIN_RESULTS_THRESHOLD,
    max_per_product:  MAX_PER_PRODUCT,
  });

  // Pairing queries benefit from more visual candidates (we need the outfit
  // items); vibe queries use a smaller slice so dense results dominate.
  const visualK = expansion.intent === 'pairing' ? Math.ceil(k * 0.7) : Math.ceil(k * 0.5);
  const visualRpc = visualEmbedding
    ? admin.rpc('search_creatives_visual', {
        query_embedding: toPgVector(visualEmbedding),
        k:               visualK,
        filter_gender:   gender,
      })
    : Promise.resolve({ data: [] as Array<Record<string, unknown>> });

  // SEARCH_V3: removed the speculative `search_products_hybrid` call and the
  // products-fallback dance below. The new primary RPC
  // (`search_products_with_creatives`) already includes every active product
  // in its candidate pool, so a dedicated fallback is no longer needed.

  // Phase 1 — Looks lane. Looks contain rich vibe / occasion / season
  // language in their concept_doc + facet_text, so they're the best source
  // for queries like "date night", "summer outfit", "best for summer".
  // SEARCH_V3 latency: scoped to vibe intent only — adds ~100ms per query
  // with zero benefit for browse/pairing queries (typed lookup wins those).
  const looksRpc = expansion.intent === 'vibe'
    ? admin.rpc('search_looks_to_products', {
        query_embedding: toPgVector(queryEmbedding),
        query_text:      bm25Text,
        k:               Math.max(8, Math.ceil(k / 2)),
        filter_gender:   gender,
        exclude_ids:     excludeIds,
      })
    : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null });

  const [denseRes, eliteRes, visualRes, looksRes] = await Promise.all([denseRpc, eliteRpc, visualRpc, looksRpc]);

  if ((denseRes as { error?: { message: string } }).error) {
    const err = (denseRes as { error: { message: string } }).error;
    console.error('[nl-search] hybrid RPC error:', err);
    return jsonRes({ ok: false, error: 'search_failed', detail: err.message }, 500);
  }

  const denseRows = ((denseRes as { data?: unknown }).data ?? []) as Array<Record<string, unknown>>;
  const denseSet  = normaliseHybridRows(denseRows);

  // Elite boost lane — RRF-fuse so elite creatives float to the top when
  // they exist for the query, but never starve the broader product pool.
  const eliteRows = ((eliteRes as { data?: unknown }).data ?? []) as Array<Record<string, unknown>>;
  const eliteError = (eliteRes as { error?: { message: string } }).error;
  if (eliteError) console.warn('[nl-search] elite lane error:', eliteError);
  const eliteSet  = eliteRows.length > 0 ? normaliseHybridRows(eliteRows) : [];

  let fused: SearchResult[];
  const visualRows = ((visualRes as { data?: unknown }).data ?? []) as Array<Record<string, unknown>>;
  if (visualRows.length > 0) {
    const visualSet: SearchResult[] = visualRows.map(r => ({
      id:                r.creative_id as string,
      entity_type:       'creative' as const,
      product_id:        r.id as string,
      creative_id:       (r.creative_id as string) ?? null,
      video_url:         (r.creative_video_url as string) ?? null,
      thumbnail_url:     (r.creative_thumbnail_url as string) ?? null,
      affiliate_url:     null,
      duration_seconds:  null,
      is_elite:          null,
      is_placeholder:    !((r.creative_video_url as string) ?? null),
      product_name:      (r.name as string) ?? null,
      product_brand:     (r.brand as string) ?? null,
      product_price:     (r.price as string) ?? null,
      product_image_url: (r.image_url as string) ?? null,
      product_url:       (r.url as string) ?? null,
      product_gender:    (r.gender as string) ?? null,
      product_type:      (r.type as string) ?? null,
      concept_doc:       (r.concept_doc as string) ?? null,
      concept_facets:    (r.concept_facets as Record<string, unknown>) ?? null,
      facet_text:        (r.facet_text as string) ?? null,
      rrf_score:         (r.rrf_score as number) ?? 0,
      dense_rank:        (r.dense_rank as number) ?? null,
      bm25_rank:         null,
      score:             0,
    }));
    fused = rrfFuse([denseSet, eliteSet, visualSet].filter(s => s.length > 0), k);
  } else if (eliteSet.length > 0) {
    fused = rrfFuse([denseSet, eliteSet], k);
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
  // type_match=NULL means the underlying product has no `type` set — keep
  // it ONLY if BM25 matched (title/brand evidence). Without text evidence,
  // an untyped product is just a dense neighbour and likely off-topic
  // (e.g. Vans Old Skool surfacing for "skirt").
  let prunedOffType = 0;
  if (filterTypes && filterTypes.length > 0) {
    const onType = dedupedResults.filter(r =>
      r.type_match === true || (r.type_match == null && r.bm25_rank != null)
    );
    if (onType.length < dedupedResults.length) {
      prunedOffType = dedupedResults.length - onType.length;
      // Reset `seen` to just the on-type product ids so the products
      // fallback doesn't re-skip the freshly pruned ones.
      seen.clear();
      for (const r of onType) if (r.product_id) seen.add(r.product_id);
      dedupedResults = onType;
    }
  }

  // ── Step 4a2: BM25 relevance gate — prevent dense-only semantic drift ────
  // When filterTypes is set, type_match already pruned junk (Step 4a).
  // When filterTypes is null/empty (untyped query like "tooth brush", "candle"),
  // dense-only neighbours in the fashion embedding space are meaningless —
  // keep ONLY rows that hit the BM25 text query. If nothing has a BM25 hit
  // the query is a cold miss: return empty rather than unrelated results.
  // Exception: true aesthetic/vibe queries ("coastal grandmother", "Y2K") have
  // no BM25 hits by design — we keep all dense results only when filterTypes
  // is non-empty (type anchor confirms semantic intent).
  const isUntypedQuery = !filterTypes || filterTypes.length === 0;
  if (dedupedResults.length > 0) {
    const bm25Hits = dedupedResults.filter(r => r.bm25_rank != null);
    if (isUntypedQuery) {
      // No type anchor — dense-only results are likely drift. Require BM25 hit.
      if (bm25Hits.length === 0) {
        // True cold miss: no text evidence in the index. Return nothing.
        dedupedResults = [];
      } else if (bm25Hits.length < dedupedResults.length) {
        seen.clear();
        for (const r of bm25Hits) if (r.product_id) seen.add(r.product_id);
        dedupedResults = bm25Hits;
      }
    } else if (expansion.intent === 'browse') {
      // Browse query with a type anchor (e.g. "denim" → ['Pants','Jacket'],
      // "candle" → ['Other']). The type filter alone isn't enough — Haiku's
      // type mapping is fuzzy ("candle"→"Other" matched plants) and the dense
      // lane returns nearest fashion neighbours regardless of the actual
      // search term. Require a BM25 hit so the user-typed keyword (or one of
      // its expansion tokens) actually appears in the product copy. If
      // nothing hits, the products fallback (Step 4b) will rescue real
      // matches via the products lane.
      if (bm25Hits.length === 0) {
        seen.clear();
        dedupedResults = [];
      } else if (bm25Hits.length < dedupedResults.length) {
        seen.clear();
        for (const r of bm25Hits) if (r.product_id) seen.add(r.product_id);
        dedupedResults = bm25Hits;
      }
    } else if (expansion.intent === 'vibe') {
      // Vibe query with a type anchor: prefer BM25 but don't hard-require it
      // (true aesthetic queries produce no BM25 signal and that's expected).
      if (bm25Hits.length > 0 && bm25Hits.length < dedupedResults.length) {
        seen.clear();
        for (const r of bm25Hits) if (r.product_id) seen.add(r.product_id);
        dedupedResults = bm25Hits;
      }
    }
  }

  // SEARCH_V3: Step 4b (products fallback dance) + Step 4c (BM25-aware
  // re-rank) removed. The new primary RPC `search_products_with_creatives`
  // already includes every active product in its candidate pool with a
  // single ranked output, so the multi-pass fallback is no longer needed.
  // Stale-code marker: keep an eye on STALE_CODE.md for the old
  // search_products_hybrid call sites pending cleanup.
  const productsAppended = 0;
  const productsFallbackPasses = 0;

  // ── Step 4d: merge looks-lane results ────────────────────────────────────
  // Looks carry rich vibe / occasion / season language in their concept_doc
  // (and facet_text post-Phase 2 backfill). For vibe and pairing intents
  // looks rows are prepended ahead of the products-only matches; for browse
  // they fill remaining slots. Dedupe by product_id so we never double-list.
  const looksRowsRaw = ((looksRes as { data?: unknown }).data ?? []) as Array<Record<string, unknown>>;
  const looksError   = (looksRes as { error?: { message: string } }).error;
  if (looksError) {
    console.warn('[nl-search] looks lane error:', looksError);
  }
  let looksAppended = 0;
  if (looksRowsRaw.length > 0) {
    const looksMapped: SearchResult[] = looksRowsRaw.map(r => ({
      id:                r.product_id as string,
      entity_type:       'creative' as const,
      product_id:        r.product_id as string,
      creative_id:       null,
      video_url:         null,
      thumbnail_url:     null,
      affiliate_url:     null,
      duration_seconds:  null,
      is_elite:          (r.is_elite as boolean) ?? null,
      is_placeholder:    true,
      product_name:      (r.product_name as string) ?? null,
      product_brand:     (r.product_brand as string) ?? null,
      product_price:     (r.product_price as string) ?? null,
      product_image_url: (r.product_image_url as string) ?? null,
      product_url:       (r.product_url as string) ?? null,
      product_gender:    (r.product_gender as string) ?? null,
      product_type:      (r.product_type as string) ?? null,
      concept_doc:       (r.concept_doc as string) ?? null,
      concept_facets:    (r.concept_facets as Record<string, unknown>) ?? null,
      facet_text:        (r.facet_text as string) ?? null,
      rrf_score:         (r.rrf_score as number) ?? 0,
      dense_rank:        (r.dense_rank as number) ?? null,
      bm25_rank:         (r.bm25_rank as number) ?? null,
      score:             (r.rrf_score as number) ?? 0,
    }));

    const wantsFront = expansion.intent === 'vibe' || expansion.intent === 'pairing';
    // For browse intent we have a hard type scope (e.g. ['Decor'] for "candles").
    // Looks-lane rows come from outfit looks, so most projected products will
    // be off-type. Hard-filter those out so we don't leak Beanies into a
    // Decor query.
    const typeAllowed = (row: SearchResult): boolean => {
      if (wantsFront) return true;
      if (!filterTypes || filterTypes.length === 0) return true;
      const t = (row.product_type ?? '').toLowerCase();
      return filterTypes.some(ft => ft.toLowerCase() === t);
    };

    // For browse queries the looks lane will return outfit projections
    // that have no semantic relation to the keyword (e.g. a Beanie row
    // for a "denim" search). Require a BM25 hit so dense-only drift
    // doesn't leak in. Vibe/pairing keep dense matches.
    const requireBm25Hit = expansion.intent === 'browse';

    const fresh: SearchResult[] = [];
    for (const row of looksMapped) {
      if (!row.product_id || seen.has(row.product_id)) continue;
      if (!typeAllowed(row)) continue;
      if (requireBm25Hit && row.bm25_rank == null) continue;
      seen.add(row.product_id);
      fresh.push(row);
      looksAppended++;
    }

    if (fresh.length > 0) {
      if (wantsFront) {
        // Looks lead for vibe/pairing — they're the source of truth for
        // occasion + outfit semantics.
        dedupedResults = [...fresh, ...dedupedResults].slice(0, k);
      } else {
        // Browse intent: only fill remaining slots so the typed creatives
        // lane keeps pole position.
        const room = Math.max(0, k - dedupedResults.length);
        if (room > 0) dedupedResults = [...dedupedResults, ...fresh.slice(0, room)];
      }
    }
  }

  // ── Step 4e: price_max post-filter (Phase 4) ────────────────────────────
  // Drop rows whose price exceeds the user's stated budget. Permissive: if
  // the row has no parseable price, keep it (we'd rather show than hide).
  let pricePruned = 0;
  if (expansion.price_max != null) {
    const max = expansion.price_max;
    const before = dedupedResults.length;
    dedupedResults = dedupedResults.filter(r => {
      if (r.product_price == null) return true;
      const n = parseFloat(String(r.product_price).replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(n)) return true;
      return n <= max;
    });
    pricePruned = before - dedupedResults.length;
  }

  // ── Step 4f: video-only filter (REMOVED in SEARCH_V3) ─────────────────
  // The new product-first RPC returns `is_placeholder=true` rows for
  // products that have no live creative yet. The client (ContinuousFeed)
  // renders those as image cards so the grid is never empty for a cold
  // category. The old server-side video_url filter would have stripped
  // these rows away, defeating the whole purpose of the V3 pivot.

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
      looks_appended:    looksAppended,
      price_pruned:      pricePruned,
      structured_tokens_count: structuredTokens.length,
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
