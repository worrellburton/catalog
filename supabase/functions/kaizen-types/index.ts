// kaizen-types — AI-powered placement sweep for the type brain
// (/admin/governance/types → "改 Kaizen types · AI").
//
// The deterministic kaizenSweep only ever maps a product onto a type node
// that ALREADY EXISTS (by name match), so it can't fix a product whose right
// home isn't in the tree yet, or one stuck under a wrong parent (a snowboard
// filed under "fashion"). This function asks Claude to read each product's
// image description + name and return the single best-fitting type PATH —
// preferring existing paths, but free to INVENT a new, sensibly-parented path
// when nothing fits. The client resolves/creates the paths (resolveOrCreatePath)
// and opens the Kaizen panel with the suggestions for review + Apply.
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

interface ProductIn { id: string; name: string; brand?: string | null; type?: string | null; path?: string | null; context?: string | null }

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
    const products = (Array.isArray(body.products) ? body.products : []).slice(0, 600) as ProductIn[];
    const typePaths = (Array.isArray(body.typePaths) ? body.typePaths : []).slice(0, 500).map(String);
    if (products.length === 0) return json({ success: false, error: 'missing products' }, 400);

    const prompt = `You are auditing a shopping catalog's product-type taxonomy and proposing better placements.

EXISTING TYPE PATHS (each a branch of the tree, segments joined by " / "):
${typePaths.join('\n')}

PRODUCTS (id | name | brand | current type | current path | what the image shows):
${products.map(p => `${p.id} | ${(p.name || '').slice(0, 90)} | ${p.brand ?? ''} | ${p.type ?? ''} | ${p.path ?? ''} | ${(p.context ?? '').slice(0, 160)}`).join('\n')}

For EACH product decide the single best-fitting type path. Rules:
- The IMAGE description is ground truth for what the item IS; the name only refines it. A name fragment ("Twist-Top Lid") must not override a photo that plainly shows a jar.
- PREFER an existing path when one genuinely fits.
- INVENT a new path when the item belongs to a category that doesn't exist yet, OR only exists under a clearly WRONG parent (e.g. a snowboard or ski wax filed under "fashion" when it is sports gear, a kitchen item under "fashion", etc.). Keep new paths shallow (1-3 segments) and parented under a sensible, broad top-level category (e.g. "sports", "home", "electronics"). Reuse a top-level that already exists when it fits.
- Group like items consistently — every snowboard should land on the SAME path, not several near-duplicates.
- Only include a product in "moves" when its best path DIFFERS from its current path/type. Leave well-placed products out.
- Never force unrelated items into a new type just to fill it.

Return ONLY JSON, no prose:
{"moves":[{"productId":"<id>","toPath":"a / b","reason":"<=8 words"}],"note":"<one short sentence on the overall changes>"}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) return json({ success: false, error: `anthropic ${res.status}: ${(await res.text()).slice(0, 200)}` }, 502);
    const out = await res.json() as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
    const text = (out.content?.find(c => c.type === 'text')?.text ?? '').replace(/```json\s*|```\s*/g, '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return json({ success: false, error: 'no JSON in model response' }, 502);
    const parsed = JSON.parse(text.slice(start, end + 1)) as { moves?: Array<{ productId?: string; toPath?: string; reason?: string }>; note?: string };
    const known = new Set(products.map(p => p.id));
    const moves = (parsed.moves ?? [])
      .filter(m => m.productId && m.toPath && known.has(String(m.productId)))
      .map(m => ({ productId: String(m.productId), toPath: String(m.toPath).trim(), reason: String(m.reason ?? '').slice(0, 80) }));

    void supabase.from('ai_usage_logs').insert({
      platform: 'anthropic', operation: 'kaizen-types', model: MODEL,
      input_tokens: out.usage?.input_tokens ?? null, output_tokens: out.usage?.output_tokens ?? null, status: 'success',
    });

    return json({ success: true, moves, note: parsed.note ?? null });
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
