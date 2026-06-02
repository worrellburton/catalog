// enrich-similarity — classify ONE product for the "Similar" rail.
//
// Claude (Haiku) extracts what the product fundamentally IS — stripped of
// marketing copy, occasions, care text and price — into:
//   • product_taxonomy.{category,subcategory,material,color}  (category = the
//     hard gate for Similar; a controlled vocabulary that de-fragments the
//     legacy products.type, e.g. Shoes/Sneakers/Sandals → footwear)
//   • similarity_profile (a clean attribute-only line)
// then calls embed-product (target=similarity) to populate similarity_embedding.
//
// This is the per-product, auto-fired equivalent of scripts/enrich-similarity.mjs.
// Invoked by the DB trigger trg_products_auto_enrich_similarity when a new
// product first gets a description. Separate from products.embedding / search.
//
// Secrets: ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Controlled category vocabulary — keep in sync with scripts/enrich-similarity.mjs.
const CATEGORIES = [
  'tops', 'knitwear', 'bottoms', 'dresses', 'outerwear', 'footwear',
  'activewear', 'swimwear', 'underwear', 'sleepwear', 'accessories',
  'headwear', 'eyewear', 'bags', 'jewelry', 'watches', 'belts',
  'grooming', 'beauty', 'fragrance', 'drinkware', 'kitchenware',
  'home-decor', 'household', 'bedding', 'books', 'food-drink', 'tech',
  'fitness', 'pet', 'toys', 'other',
];

function buildPrompt(p: { name: string; brand: string | null; type: string | null; description: string | null }) {
  return `You classify catalogue products for a "find similar items" feature. Extract ONLY what the product fundamentally IS — ignore marketing copy, occasions, care instructions, and price.

Product name: ${p.name}
Brand: ${p.brand || 'Unknown'}
Existing type: ${p.type || 'Unknown'}
Description (may contain marketing fluff — extract facts only):
${(p.description || 'none').slice(0, 600)}

Return ONLY a JSON object (no prose, no markdown fences):
{
  "category": one of [${CATEGORIES.join(', ')}] — the single best fit; use "other" only if truly none apply,
  "subcategory": 1-3 words for the specific item (e.g. "crew sweater", "coffee glass", "hair clay", "wide-leg jeans"),
  "material": main material(s) in 1-3 words, or "" if unknown,
  "color": primary colour in 1-2 words, or "" if unknown,
  "similarity_profile": one short line, lowercase, of the discriminative attributes only, in the form "category · subcategory · material · color · form/notes". NO marketing, NO occasions, NO care text, NO price. Keep under 160 chars.
}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body: { id?: string; force?: boolean };
  try { body = await req.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
  const { id, force = false } = body;
  if (!id || typeof id !== 'string') return json({ error: 'missing id' }, 400);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY not set' }, 500);
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data: product, error: fetchErr } = await supabase
    .from('products')
    .select('id, name, brand, type, description, product_taxonomy, similarity_profile')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) return json({ error: 'fetch failed', detail: fetchErr.message }, 500);
  if (!product || !product.name) return json({ skipped: 'no product/name' });
  if (!force && product.similarity_profile) return json({ skipped: 'already profiled' });

  // Classify with Claude Haiku.
  let parsed: any;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: buildPrompt(product) }],
      }),
    });
    const data = await res.json();
    let text = (data?.content?.[0]?.text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    parsed = JSON.parse(text);
  } catch (err: any) {
    return json({ error: 'classify failed', detail: err?.message ?? String(err) }, 500);
  }

  let category = String(parsed.category || '').toLowerCase().trim();
  if (!CATEGORIES.includes(category)) category = 'other';
  const taxonomy = {
    ...(product.product_taxonomy || {}),
    category,
    subcategory: String(parsed.subcategory || '').trim(),
    material: String(parsed.material || '').trim(),
    color: String(parsed.color || '').trim(),
  };
  const profile = String(parsed.similarity_profile || '').trim().slice(0, 200);

  const { error: updErr } = await supabase
    .from('products')
    .update({ product_taxonomy: taxonomy, similarity_profile: profile })
    .eq('id', id);
  if (updErr) return json({ error: 'update failed', detail: updErr.message }, 500);

  // Embed the fresh profile into similarity_embedding (reuse embed-product).
  try {
    await fetch(`${supabaseUrl}/functions/v1/embed-product`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
      body: JSON.stringify({ id, target: 'similarity', force: true }),
    });
  } catch (_err) { /* embedding is retried by the next sweep/trigger; profile is saved */ }

  return json({ ok: true, id, category, subcategory: taxonomy.subcategory });
});
