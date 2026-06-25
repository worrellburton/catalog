// Search client — calls the `search` edge function (V3 product-primary,
// gte-small embedding, BM25+dense+RRF on the server). Replaces the old
// nl-search / semantic-search pair.
//
// Result shape preserves the SemanticCreative interface the consumer feed
// already maps over, so ContinuousFeed only needs to swap the import.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '~/utils/supabase';
import { cleanSearchQuery, searchFallbackQuery } from '~/utils/searchIntent';

export interface SemanticCreative {
  id: string;                       // creative UUID, or product UUID when placeholder
  entity_type: 'creative';          // legacy field kept for ContinuousFeed compatibility
  product_id: string;
  creative_id: string | null;       // null when row is a product-only placeholder
  is_placeholder: boolean;
  video_url: string | null;
  thumbnail_url: string | null;
  affiliate_url: string | null;
  duration_seconds: number | null;
  is_elite: boolean;
  product_name: string | null;
  product_brand: string | null;
  product_price: string | null;
  product_image_url: string | null;
  product_url: string | null;
  product_gender: string | null;
  product_type: string | null;
  score: number;
}

export interface SemanticLook {
  id: string;
  legacy_id: number | null;
  title: string | null;
  creator_handle: string | null;
  description: string | null;
  gender: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  mobile_video_url: string | null;
  score: number;
}

interface RawSearchHit extends Omit<SemanticCreative, 'entity_type'> {}

export interface SearchResponse {
  ok:       boolean;
  query:    string;
  results:  SemanticCreative[];
  looks:    SemanticLook[];
  count:    number;
  took_ms:  number;
  error?:   string;
}

const SEARCH_ENDPOINT = `${SUPABASE_URL}/functions/v1/search`;

export async function search(
  query: string,
  options: {
    k?:           number;
    gender?:      string | null;
    exclude_ids?: string[];
    signal?:      AbortSignal;
  } = {}
): Promise<SearchResponse> {
  // Intent-first: strip conversational scaffolding ("I need a dress for italy"
  // → "dress italy") so the semantic engine matches the wish, not the filler.
  const trimmed = cleanSearchQuery(query);
  if (!trimmed) {
    return { ok: true, query: '', results: [], looks: [], count: 0, took_ms: 0 };
  }

  const first = await runSearch(trimmed, options);
  // Subject fallback: a conversational/contextual query ("dress italy") often
  // matches no inventory because products aren't tagged by destination. If the
  // full query came back empty, retry on the bare garment ("dress") so the
  // shopper lands on a populated catalog instead of a dead end. The fun catalog
  // NAME still uses the original query, so the title keeps the "Italy" flavour.
  if (first.ok && first.results.length === 0 && first.looks.length === 0) {
    const fallback = searchFallbackQuery(trimmed);
    if (fallback) {
      const second = await runSearch(fallback, options);
      if (second.ok && (second.results.length > 0 || second.looks.length > 0)) return second;
    }
  }
  return first;
}

async function runSearch(
  trimmed: string,
  options: { k?: number; gender?: string | null; exclude_ids?: string[]; signal?: AbortSignal },
): Promise<SearchResponse> {
  const { k = 24, gender = null, exclude_ids, signal } = options;
  let res: Response;
  try {
    res = await fetch(SEARCH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        Authorization:   `Bearer ${SUPABASE_ANON_KEY}`,
        apikey:          SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ query: trimmed, k, gender, exclude_ids }),
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    return { ok: false, query: trimmed, results: [], looks: [], count: 0, took_ms: 0, error: 'Network error' };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    return { ok: false, query: trimmed, results: [], looks: [], count: 0, took_ms: 0, error: text.slice(0, 300) };
  }

  const payload = await res.json() as {
    query: string;
    results: RawSearchHit[];
    looks?: SemanticLook[];
    count: number;
    took_ms: number;
    error?: string;
  };
  if (payload.error) {
    return { ok: false, query: payload.query, results: [], looks: [], count: 0, took_ms: payload.took_ms ?? 0, error: payload.error };
  }

  return {
    ok:       true,
    query:    payload.query,
    results:  payload.results.map(r => ({ ...r, entity_type: 'creative' as const })),
    looks:    payload.looks ?? [],
    count:    payload.count,
    took_ms:  payload.took_ms,
  };
}

// Trigger embed-product for a single product. Used by admin tools after
// editing a product, and by scripts/embed-products.mjs for batch backfill.
export async function triggerEmbedProduct(
  id: string,
  options: { force?: boolean; authToken?: string } = {}
): Promise<{ ok: boolean; error?: string }> {
  const token = options.authToken ?? SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/embed-product`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      Authorization:   `Bearer ${token}`,
      apikey:          SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ id, force: options.force ?? false }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    return { ok: false, error: text.slice(0, 300) };
  }
  const data = await res.json().catch(() => ({}));
  if (data?.error) return { ok: false, error: String(data.error) };
  return { ok: true };
}
