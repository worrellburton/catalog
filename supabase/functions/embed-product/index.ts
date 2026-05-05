// embed-product — generates a 384-dim embedding for one product using
// Supabase.ai's built-in gte-small model and writes it back to
// products.embedding + products.embedded_at.
//
// • No external API keys: gte-small runs in-edge.
// • Embedding source: name + brand + type + description (concatenated).
// • Idempotent: skips when embedding already exists unless force=true.
//
// Request body: { id: string, force?: boolean }
//
// Auth: requires the same SUPABASE_SERVICE_ROLE_KEY that other admin-side
// edge functions use. Called by:
//   • DB trigger trg_products_auto_embed (via vault secret).
//   • scripts/embed-products.mjs (one-shot batch backfill).

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

// Lazy-init: same Session can be reused across invocations on warm starts.
let session: { run: (input: string, opts?: { mean_pool?: boolean; normalize?: boolean }) => Promise<number[]> } | null = null;
const getSession = () => {
  if (!session) session = new Supabase.ai.Session('gte-small');
  return session;
};

const buildDoc = (p: { name: string | null; brand: string | null; type: string | null; description: string | null }): string => {
  // Order matters: name first (carries the most weight in the model's
  // attention), then brand, type, description. Keep it short — gte-small
  // truncates at 512 tokens.
  const parts = [p.name, p.brand, p.type, p.description]
    .map(s => (s ?? '').trim())
    .filter(Boolean);
  return parts.join('. ').slice(0, 4000);
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body: { id?: string; force?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  const { id, force = false } = body;
  if (!id || typeof id !== 'string') return json({ error: 'missing id' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );

  const { data: product, error: fetchErr } = await supabase
    .from('products')
    .select('id, name, brand, type, description, is_active, embedding, embedded_at')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) return json({ error: 'fetch failed', detail: fetchErr.message }, 500);
  if (!product) return json({ error: 'product not found' }, 404);
  if (!product.name) return json({ skipped: 'no name' });

  if (!force && product.embedding) {
    return json({ skipped: 'already embedded', embedded_at: product.embedded_at });
  }

  const doc = buildDoc(product);
  if (!doc) return json({ skipped: 'empty doc' });

  let embedding: number[];
  try {
    const sess = getSession();
    embedding = await sess.run(doc, { mean_pool: true, normalize: true });
  } catch (err: any) {
    return json({ error: 'embedding failed', detail: err?.message ?? String(err) }, 500);
  }

  if (!Array.isArray(embedding) || embedding.length !== 384) {
    return json({ error: 'unexpected embedding shape', length: Array.isArray(embedding) ? embedding.length : null }, 500);
  }

  const { error: updateErr } = await supabase
    .from('products')
    .update({
      embedding: embedding as unknown as string,
      embedded_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (updateErr) return json({ error: 'update failed', detail: updateErr.message }, 500);

  return json({ ok: true, id, dims: embedding.length });
});
