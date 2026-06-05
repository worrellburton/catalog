// search — V3 search edge function (products + looks).
//
// Pipeline:
//   1. Embed the user's query with Supabase.ai gte-small (384-dim).
//   2. Call search_products AND search_looks RPCs in parallel.
//   3. Return both result sets so the consumer feed can interleave them.
//
// No external APIs, no Claude, no OpenAI, no TwelveLabs in the search path.
// Latency budget: ~150 ms cold, ~60 ms warm.
//
// Request body:
//   {
//     query:        string,
//     k?:           number,        // default 24, max 60
//     gender?:      'male' | 'female' | 'unisex' | null,
//     exclude_ids?: string[]       // product_ids already shown
//   }

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Supabase: { ai: { Session: new (model: string) => { run: (input: string, opts?: { mean_pool?: boolean; normalize?: boolean }) => Promise<number[]> } } };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

let session: { run: (input: string, opts?: { mean_pool?: boolean; normalize?: boolean }) => Promise<number[]> } | null = null;
const getSession = () => {
  if (!session) session = new Supabase.ai.Session('gte-small');
  return session;
};

interface SearchHit {
  id: string;
  product_id: string;
  creative_id: string | null;
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

interface LookHit {
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const startedAt = Date.now();

  let body: {
    query?: string;
    k?: number;
    gender?: string | null;
    exclude_ids?: string[];
    warmup?: boolean;
    variant?: string;   // 'v7' opts into the shadow search_products_v7 (facet routing). Default: live.
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  // Keep-warm ping (pg_cron): load the gte-small model into the isolate so the
  // first real query doesn't pay the cold-start (~1.2s → ~370ms). Must run an
  // actual embed — getSession() alone lazy-inits but doesn't load weights.
  if (body.warmup === true) {
    try {
      await getSession().run('warm', { mean_pool: true, normalize: true });
      return json({ ok: true, warm: true, took_ms: Date.now() - startedAt });
    } catch (err: any) {
      return json({ ok: false, warm: false, detail: err?.message ?? String(err) }, 500);
    }
  }

  const query = (body.query ?? '').trim();
  if (!query) return json({ results: [], looks: [], query, took_ms: 0 });

  const k = Math.min(Math.max(body.k ?? 24, 1), 60);
  const gender = body.gender && ['male', 'female', 'unisex'].includes(body.gender)
    ? body.gender
    : null;
  const excludeIds = Array.isArray(body.exclude_ids)
    ? body.exclude_ids.filter((s): s is string => typeof s === 'string').slice(0, 500)
    : [];

  // 1. Embed the query (in-edge, ~50ms warm).
  let queryEmbedding: number[];
  try {
    queryEmbedding = await getSession().run(query, { mean_pool: true, normalize: true });
  } catch (err: any) {
    return json({ error: 'embedding failed', detail: err?.message ?? String(err) }, 500);
  }
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length !== 384) {
    return json({ error: 'unexpected embedding shape' }, 500);
  }

  // 2. Hybrid retrieval — products + looks in parallel.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );

  const embeddingStr = queryEmbedding as unknown as string;
  const genderForLooks = gender === 'male' ? 'men' : gender === 'female' ? 'women' : null;

  const productRpc = body.variant === 'v7' ? 'search_products_v7' : 'search_products';

  const [productsResult, looksResult] = await Promise.all([
    supabase.rpc(productRpc, {
      query_embedding: embeddingStr,
      query_text:      query,
      k,
      filter_gender:   gender,
      exclude_ids:     excludeIds,
    }),
    supabase.rpc('search_looks', {
      query_embedding: embeddingStr,
      query_text:      query,
      k:               Math.min(k, 12),
      filter_gender:   genderForLooks,
    }),
  ]);

  if (productsResult.error) {
    return json({ error: 'search failed', detail: productsResult.error.message }, 500);
  }

  const results = (productsResult.data ?? []) as SearchHit[];
  const looks = (looksResult.data ?? []) as LookHit[];

  return json({
    query,
    results,
    looks,
    count:   results.length,
    took_ms: Date.now() - startedAt,
  });
});
