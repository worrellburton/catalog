// polish-primary-image
//
// Reframes a product's existing primary image into a standardized 5:4
// e-commerce packshot using fal.ai's nano-banana-2/edit pipeline.
// Preserves the source background and product appearance — only adds
// uniform padding so every primary image in the catalog grid lines up.
//
// POST { product_id: string }
// → 200 { success: true, polished_url, pre_polish_url }
//   or { success: false, error }
//
// Auth: admin JWT or service-role JWT (same pattern as
// pick-primary-image — the role claim is decoded out of the JWT
// payload so a service-role call from a trigger can't be denied by a
// byte-equality mismatch against the function's env var).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

const FAL_BASE_SYNC = 'https://fal.run';
const NANO_BANANA_SLUG = 'fal-ai/nano-banana/edit';
const FAL_CALL_TIMEOUT_MS = 55_000;

// Polish prompt — fixed string per the product spec. Reframes the
// existing primary image into a uniform 5:4 product-grid shot without
// touching the product itself.
const POLISH_PROMPT = [
  "Reframe this product image into a standardized e-commerce shot with a 5:4 aspect ratio (landscape, e.g. 2000x1600px).",
  "Keep the product's existing background exactly as-is — do not remove, replace, or alter it.",
  "Center the product both horizontally and vertically so it occupies approximately 60% of the frame, with equal padding (~15% of the canvas) on all four sides, extending the existing background naturally to fill any added space.",
  "Preserve the product's original colors, texture, lighting, proportions, and details exactly — do not alter, recolor, or restyle the product itself.",
  "Output a crisp image suitable for a uniform product catalog grid.",
].join(' ');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function callNanoBanana(prompt: string, imageUrl: string, falKey: string): Promise<{ url: string | null; error: string | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FAL_CALL_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${FAL_BASE_SYNC}/${NANO_BANANA_SLUG}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${falKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        image_urls: [imageUrl],
        num_images: 1,
      }),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as { name?: string })?.name === 'AbortError') {
      return { url: null, error: `timeout_${FAL_CALL_TIMEOUT_MS}ms` };
    }
    return { url: null, error: `network_error:${String(err).slice(0, 200)}` };
  }
  clearTimeout(timer);
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    return { url: null, error: `fal_${res.status}:${text.slice(0, 300)}` };
  }
  let parsed: { images?: Array<{ url?: string }> };
  try { parsed = JSON.parse(text) as typeof parsed; } catch { return { url: null, error: 'fal_bad_json' }; }
  const url = parsed.images?.[0]?.url;
  if (!url) return { url: null, error: 'fal_no_image' };
  return { url, error: null };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ success: false, error: 'POST only' }, 405);

  const supabaseUrl    = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const falKey         = Deno.env.get('FAL_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return json({ success: false, error: 'edge function misconfigured' });
  if (!falKey) return json({ success: false, error: 'FAL_KEY not configured' });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ success: false, error: 'unauthorized' }, 401);
  const token = authHeader.replace('Bearer ', '');
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // Decode the JWT role claim to allow service-role callers (triggers)
  // to bypass the admin gate. Byte-equality against the env var fails
  // when the vault holds a different (still valid) service-role JWT.
  let isServiceRole = false;
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload?.role === 'service_role') isServiceRole = true;
    }
  } catch { /* fall through to user-JWT path */ }
  if (!isServiceRole) {
    const { data: { user: caller } } = await admin.auth.getUser(token);
    if (!caller) return json({ success: false, error: 'unauthorized' }, 401);
    const { data: prof } = await admin.from('profiles').select('is_admin, role').eq('id', caller.id).maybeSingle();
    const isAdmin = prof?.is_admin === true || prof?.role === 'admin' || prof?.role === 'super_admin';
    if (!isAdmin) return json({ success: false, error: 'admin only' }, 403);
  }

  let body: { product_id?: string };
  try { body = await req.json(); }
  catch { return json({ success: false, error: 'JSON body required' }); }

  const productId = body.product_id;
  if (!productId) return json({ success: false, error: 'product_id required' });

  const { data: product, error: loadErr } = await admin
    .from('products')
    .select('id, primary_image_url, primary_image_polished, primary_image_pre_polish_url')
    .eq('id', productId)
    .maybeSingle();
  if (loadErr) return json({ success: false, error: loadErr.message });
  if (!product) return json({ success: false, error: 'product not found' }, 404);
  if (!product.primary_image_url) return json({ success: false, error: 'product has no primary_image_url to polish' });

  // The current primary URL becomes the "source" for the polish call.
  // If a prior pre-polish URL is stored, keep that — the original
  // pre-polish source is preserved across multiple polish runs.
  const sourceUrl    = product.primary_image_url;
  const prePolishUrl = product.primary_image_pre_polish_url ?? sourceUrl;

  const result = await callNanoBanana(POLISH_PROMPT, sourceUrl, falKey);
  if (!result.url) return json({ success: false, error: result.error || 'polish failed' });

  const { error: updateErr } = await admin.from('products').update({
    primary_image_url:           result.url,
    primary_image_polished:      true,
    primary_image_polished_at:   new Date().toISOString(),
    primary_image_pre_polish_url: prePolishUrl,
  }).eq('id', productId);
  if (updateErr) return json({ success: false, error: updateErr.message });

  return json({
    success: true,
    polished_url: result.url,
    pre_polish_url: prePolishUrl,
  });
});
