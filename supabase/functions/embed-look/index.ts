// embed-look — generates a 384-dim embedding for one look using
// Supabase.ai's built-in gte-small model and writes it back to
// looks.embedding + looks.embedded_at.
//
// Embedding source: title + creator_handle + description + product names/brands
// (via look_products join). This ensures "nike shoes" retrieves looks containing
// Nike shoe products.
//
// Request body: { id: string, force?: boolean }

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

  const { data: look, error: fetchErr } = await supabase
    .from('looks')
    .select(`
      id, title, creator_handle, description, embedding, embedded_at,
      look_products (
        products ( name, brand )
      )
    `)
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) return json({ error: 'fetch failed', detail: fetchErr.message }, 500);
  if (!look) return json({ error: 'look not found' }, 404);
  if (!look.title) return json({ skipped: 'no title' });

  if (!force && look.embedding) {
    return json({ skipped: 'already embedded', embedded_at: look.embedded_at });
  }

  const productNames = (look.look_products ?? [])
    .map((lp: any) => {
      const p = lp.products;
      if (!p) return '';
      return [p.name, p.brand].filter(Boolean).join(' ');
    })
    .filter(Boolean)
    .join('. ');

  const doc = [look.title, look.creator_handle, look.description, productNames]
    .map(s => (s ?? '').trim())
    .filter(Boolean)
    .join('. ')
    .slice(0, 4000);

  if (!doc) return json({ skipped: 'empty doc' });

  let embedding: number[];
  try {
    embedding = await getSession().run(doc, { mean_pool: true, normalize: true });
  } catch (err: any) {
    return json({ error: 'embedding failed', detail: err?.message ?? String(err) }, 500);
  }

  if (!Array.isArray(embedding) || embedding.length !== 384) {
    return json({ error: 'unexpected embedding shape', length: Array.isArray(embedding) ? embedding.length : null }, 500);
  }

  const { error: updateErr } = await supabase
    .from('looks')
    .update({
      embedding: embedding as unknown as string,
      embedded_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (updateErr) return json({ error: 'update failed', detail: updateErr.message }, 500);

  return json({ ok: true, id, dims: embedding.length });
});
