// Thin client for the nl-search and embed-entity edge functions.
// All heavy logic (query planning, embedding, retrieval) lives server-side.
//
// Embedding backend : TwelveLabs Marengo-retrieval-2.7 (1024-dim text)
// Concept generation: Anthropic Claude Haiku

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

export interface SemanticLook {
  id: string;        // UUID
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

export interface SemanticProduct {
  id: string;        // UUID
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

export type SemanticResult = SemanticLook | SemanticProduct;

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
    signal?: AbortSignal;
  } = {}
): Promise<NlSearchResponse> {
  const { k = 20, gender, session_id, user_id, signal } = options;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/nl-search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ query, k, gender, session_id, user_id }),
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
// Trigger the embed-entity function for a specific product or look.
// Called by the admin panel after creating/updating entities.

export async function triggerEmbedEntity(
  id: string,
  entity_type: 'product' | 'look',
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
