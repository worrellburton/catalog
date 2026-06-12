// kaizen-refine — natural-language steering for the Kaizen panel.
//
// The admin types a note under the report ("the glasses should go into
// dishware instead of art") and this function asks Claude to translate
// it into concrete moves against the REAL catalog: which product ids,
// and which type path each should land on (existing paths preferred;
// new paths allowed when the note names a type that doesn't exist yet).
// The client resolves/creates the paths and swaps the suggestions into
// the open report — the admin still reviews and applies.
//
// Auth: caller must be a signed-in admin (profiles.is_admin).
// Secrets: ANTHROPIC_API_KEY.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MODEL = 'claude-sonnet-4-6';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

interface ProductIn { id: string; name: string; brand?: string | null; type?: string | null; context?: string | null }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ success: false, error: 'method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ success: false, error: 'server misconfigured' }, 500);
  if (!apiKey) return json({ success: false, error: 'ANTHROPIC_API_KEY not set' }, 500);
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return json({ success: false, error: 'invalid auth' }, 401);
    const { data: prof } = await supabase.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
    if (!prof?.is_admin) return json({ success: false, error: 'admin only' }, 403);

    const body = await req.json().catch(() => ({}));
    const instruction = String(body.instruction ?? '').trim().slice(0, 500);
    const products = (Array.isArray(body.products) ? body.products : []).slice(0, 600) as ProductIn[];
    const typePaths = (Array.isArray(body.typePaths) ? body.typePaths : []).slice(0, 400).map(String);
    if (!instruction) return json({ success: false, error: 'missing instruction' }, 400);
    if (products.length === 0) return json({ success: false, error: 'missing products' }, 400);

    const prompt = `You are refining a product-catalog taxonomy report based on the admin's note.

ADMIN'S NOTE: "${instruction}"

EXISTING TYPE PATHS (segments joined by " / "):
${typePaths.join('\n')}

PRODUCTS (id | name | brand | current type | what the image shows):
${products.map(p => `${p.id} | ${(p.name || '').slice(0, 90)} | ${p.brand ?? ''} | ${p.type ?? ''} | ${(p.context ?? '').slice(0, 140)}`).join('\n')}

Translate the note into concrete moves. Rules:
- Only move products the note clearly refers to (match by name/brand/type semantics, e.g. "the glasses" → products whose names are glasses/cups). When the note is about a KIND of product, include every product of that kind.
- toPath must be a full type path. STRONGLY prefer an existing path; invent a new one only when the note names a destination that doesn't exist — keep it shallow and parented sensibly (e.g. "home / dishware").
- If the note asks for something other than moving products between types, make no moves and explain in "note".

Return ONLY JSON, no prose:
{"moves":[{"productId":"<id>","toPath":"a / b"}],"note":"<one short sentence summarising what you did or why nothing matched>"}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) return json({ success: false, error: `anthropic ${res.status}: ${(await res.text()).slice(0, 200)}` }, 502);
    const out = await res.json() as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
    const text = (out.content?.find(c => c.type === 'text')?.text ?? '').replace(/```json\s*|```\s*/g, '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return json({ success: false, error: 'no JSON in model response' }, 502);
    const parsed = JSON.parse(text.slice(start, end + 1)) as { moves?: Array<{ productId?: string; toPath?: string }>; note?: string };
    const known = new Set(products.map(p => p.id));
    const moves = (parsed.moves ?? [])
      .filter(m => m.productId && m.toPath && known.has(String(m.productId)))
      .map(m => ({ productId: String(m.productId), toPath: String(m.toPath).trim() }));

    void supabase.from('ai_usage_logs').insert({
      platform: 'anthropic', operation: 'kaizen-refine', model: MODEL,
      input_tokens: out.usage?.input_tokens ?? null, output_tokens: out.usage?.output_tokens ?? null, status: 'success',
    });

    return json({ success: true, moves, note: parsed.note ?? null });
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
