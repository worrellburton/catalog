// pick-primary-image
//
// Picks the "solo product" image from a product's photo set. Returns
// the URL + index of the cleanest hero shot (product alone, on a
// plain background, no human, no other products).
//
// Used by:
//   - The /admin/data "Pick primary images" batch tool (admin)
//   - The post-scrape hook (auto-run after a product is ingested)
//
// Strategy: send up to 8 image URLs to Claude Haiku (vision). Ask it
// to score each image on solo-ness, return JSON with the best
// index + score. We trust Claude's URL fetching — every product
// image lives on a public HTTPS host (Cloudinary, Shopify CDN,
// merchant CDN, etc.) that Anthropic can reach.
//
// POST { product_id: string, name?: string, brand?: string, image_urls: string[] }
// → 200 { success: true, picked_index: number, picked_url: string, score: number }
//   or { success: false, error: string }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const MAX_IMAGES = 8;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

interface PickBody {
  product_id?: string;
  name?: string;
  brand?: string;
  image_urls?: string[];
}

interface PickResult {
  index: number;
  score: number;
}

function buildPrompt(ctx: { name?: string; brand?: string; count: number }): string {
  const desc = [ctx.brand, ctx.name].filter(Boolean).join(' - ') || 'this product';
  return [
    `You are looking at ${ctx.count} product photo${ctx.count === 1 ? '' : 's'} of "${desc}".`,
    'Pick the single best PRIMARY image. The primary image must show ONLY the product itself — no human in the frame, no other products, no lifestyle scenery. A clean studio shot, packshot, or plain-background hero is ideal.',
    '',
    'Score each image 0.0 to 1.0:',
    '  1.0 = product alone on plain background, no human, no other items, no clutter',
    '  0.7 = product alone but mannequin/dress form or slight backdrop',
    '  0.4 = on-model shot (human visible) OR multi-product flatlay',
    '  0.1 = pure lifestyle scene, multiple products, mostly humans',
    '',
    'The images are passed in order. Return ONLY valid JSON of the form:',
    '{"picks":[{"index":0,"score":0.85},{"index":1,"score":0.4}, ...]}',
    'No prose, no markdown — just the JSON object.',
  ].join('\n');
}

async function callClaude(imageUrls: string[], ctx: { name?: string; brand?: string }): Promise<PickResult[]> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const content: unknown[] = [];
  imageUrls.forEach((url, i) => {
    content.push({ type: 'text', text: `Image ${i}:` });
    content.push({ type: 'image', source: { type: 'url', url } });
  });
  content.push({ type: 'text', text: buildPrompt({ name: ctx.name, brand: ctx.brand, count: imageUrls.length }) });

  const resp = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 600,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Claude ${resp.status}: ${text.slice(0, 240)}`);
  }
  const body = await resp.json();
  const text = (body?.content?.[0]?.text || '').trim();
  // Extract the first {...} object from the response in case Claude
  // wraps it in code fences despite the instruction.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in Claude response: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(match[0]) as { picks?: PickResult[] };
  if (!Array.isArray(parsed.picks)) throw new Error('Claude response missing picks[]');
  return parsed.picks;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ success: false, error: 'POST only' }, 405);

  const supabaseUrl    = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ success: false, error: 'edge function misconfigured' });
  }

  // Admin gate via the caller's JWT.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ success: false, error: 'unauthorized' }, 401);
  const token = authHeader.replace('Bearer ', '');
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: { user: caller } } = await admin.auth.getUser(token);
  if (!caller) return json({ success: false, error: 'unauthorized' }, 401);
  const { data: prof } = await admin.from('profiles').select('is_admin, role').eq('id', caller.id).maybeSingle();
  const isAdmin = prof?.is_admin === true || prof?.role === 'admin' || prof?.role === 'super_admin';
  if (!isAdmin) return json({ success: false, error: 'admin only' }, 403);

  let body: PickBody;
  try { body = await req.json(); }
  catch { return json({ success: false, error: 'JSON body required' }); }

  const productId = body.product_id;
  const imageUrls = (body.image_urls || [])
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
    .slice(0, MAX_IMAGES);

  if (!productId) return json({ success: false, error: 'product_id required' });
  if (imageUrls.length === 0) return json({ success: false, error: 'no images to consider' });

  // Trivial case: 1 image → no choice to make, just persist it.
  if (imageUrls.length === 1) {
    await admin.from('products').update({
      primary_image_url: imageUrls[0],
      primary_image_index: 0,
      primary_image_score: 1.0,
      primary_image_picked_at: new Date().toISOString(),
      primary_image_picked_by: 'vision',
    }).eq('id', productId);
    return json({ success: true, picked_index: 0, picked_url: imageUrls[0], score: 1.0 });
  }

  let picks: PickResult[];
  try {
    picks = await callClaude(imageUrls, { name: body.name, brand: body.brand });
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }

  // Highest score wins; ties break to lower index (earlier image).
  const best = picks
    .filter(p => Number.isInteger(p.index) && p.index >= 0 && p.index < imageUrls.length)
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))[0];
  if (!best) return json({ success: false, error: 'Claude returned no usable picks' });

  const pickedUrl = imageUrls[best.index];
  const { error: updateErr } = await admin.from('products').update({
    primary_image_url: pickedUrl,
    primary_image_index: best.index,
    primary_image_score: best.score,
    primary_image_picked_at: new Date().toISOString(),
    primary_image_picked_by: 'vision',
  }).eq('id', productId);
  if (updateErr) return json({ success: false, error: updateErr.message });

  return json({ success: true, picked_index: best.index, picked_url: pickedUrl, score: best.score });
});
