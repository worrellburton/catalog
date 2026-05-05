// Thin client for the nl-search and embed-entity edge functions.
// All heavy logic (query planning, embedding, retrieval) lives server-side.
//
// Embedding backend : OpenAI text-embedding-3-small (1536-dim) for the text
//                     lane; TwelveLabs Marengo 3.0 (512-dim) for the visual lane.
// Concept generation: Anthropic Claude Haiku
//
// Search is creative-first: every result is a SemanticCreative carrying its
// joined product fields. Legacy product/look entity types have been removed.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '~/utils/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

type SearchIntent =
  | 'outfit_pairing'
  | 'occasion_lookup'
  | 'product_find'
  | 'vibe_browse'
  | 'lookalike'
  | 'ambiguous';

export interface QueryPlan {
  intent: SearchIntent;
  rewrites: string[];
  constraints: { gender?: string; occasion?: string; price_band?: string };
  result_shape: ('looks' | 'products' | 'creatives')[];
  anchor_name?: string;
}

export interface SemanticCreative {
  id: string;                       // creative UUID (or product UUID when placeholder)
  entity_type: 'creative';
  product_id: string;
  // SEARCH_V3: present when row is hydrated from a real creative; null when
  // the row is a product-only placeholder (no live video yet).
  creative_id?: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  affiliate_url: string | null;
  duration_seconds: number | null;
  is_elite: boolean | null;
  // SEARCH_V3: true when no live creative exists for this product. The UI
  // should fall back to an image card.
  is_placeholder?: boolean;
  product_name: string | null;
  product_brand: string | null;
  product_price: string | null;
  product_image_url: string | null;
  product_url: string | null;
  product_gender: string | null;
  product_type: string | null;
  concept_doc: string | null;
  facet_text?: string | null;
  score: number;
}

export type SemanticResult = SemanticCreative;

export interface NlSearchResponse {
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
    visual_lane?: boolean;
  } | null;
  error?: string;
}

// ── nl-search call ────────────────────────────────────────────────────────────

export async function nlSearch(
  query: string,
  options: {
    k?: number;
    gender?: string;
    session_id?: string;
    user_id?: string;
    exclude_ids?: string[];
    signal?: AbortSignal;
  } = {}
): Promise<NlSearchResponse> {
  const { k = 24, gender, session_id, user_id, exclude_ids, signal } = options;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/nl-search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ query, k, gender, session_id, user_id, exclude_ids }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    return {
      ok: false,
      results: [],
      query_plan: null,
      cold_miss: true,
      query_id: null,
      meta: null,
      error: text.slice(0, 300),
    };
  }

  return res.json() as Promise<NlSearchResponse>;
}

// ── embed-entity call (admin / background use) ────────────────────────────────
// Trigger the embed-entity function for a specific creative. Called by the
// admin panel / backfill script after creating or updating a product creative.

export async function triggerEmbedEntity(
  id: string,
  entity_type: 'creative' = 'creative',
  force = false,
  authToken?: string
): Promise<{ ok: boolean; error?: string }> {
  const token = authToken ?? SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/embed-entity`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ id, entity_type, force }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    return { ok: false, error: text.slice(0, 200) };
  }
  return res.json() as Promise<{ ok: boolean; error?: string }>;
}
