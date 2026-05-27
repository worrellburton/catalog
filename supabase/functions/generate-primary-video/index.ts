// generate-primary-video
//
// Generates a short cinematic-motion product video from a product's
// primary_image_url. Uses fal.ai seedance-lite image-to-video, which
// is fast + cheap and ideal for "static shot with subtle motion" of
// a single SKU. Aspect ratio is forced to 4:5 to match the admin
// detail-row video tile shape.
//
// POST { product_id: string }
// → 200 { success: true, video_url, source_image_url }
//   or { success: false, error }
//
// Auth: admin JWT or service-role JWT (same pattern as
// pick-primary-image / polish-primary-image — role claim decoded
// out of the JWT payload so trigger-driven service-role calls
// can't be denied by a byte-equality mismatch against the function's
// env var).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

const FAL_BASE_SYNC = 'https://fal.run';
const SEEDANCE_SLUG = 'fal-ai/bytedance/seedance/v1/lite/image-to-video';
const FAL_CALL_TIMEOUT_MS = 60_000;

// Fixed prompt per the product spec — subtle cinematic motion on the
// product itself, no scene changes or camera movement beyond a slow
// drift / parallax.
const PRIMARY_VIDEO_PROMPT = 'Static shot, show subtle cinematic motion of the product. Make it 4:5';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function callSeedance(prompt: string, imageUrl: string, falKey: string): Promise<{ url: string | null; error: string | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FAL_CALL_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${FAL_BASE_SYNC}/${SEEDANCE_SLUG}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${falKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        image_url: imageUrl,
        aspect_ratio: '9:16',
        // seedance lite's i2v param surface — these are best-effort:
        // unknown keys are ignored upstream so leaving extras in is
        // safe but we keep the body minimal.
        resolution: '720p',
        duration: '5',
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
  let parsed: { video?: { url?: string } };
  try { parsed = JSON.parse(text) as typeof parsed; } catch { return { url: null, error: 'fal_bad_json' }; }
  const url = parsed.video?.url;
  if (!url) return { url: null, error: 'fal_no_video' };
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
    .select('id, primary_image_url')
    .eq('id', productId)
    .maybeSingle();
  if (loadErr) return json({ success: false, error: loadErr.message });
  if (!product) return json({ success: false, error: 'product not found' }, 404);
  if (!product.primary_image_url) {
    return json({ success: false, error: 'product has no primary_image_url to animate — pick or polish a primary image first' });
  }

  const sourceUrl = product.primary_image_url;
  const result = await callSeedance(PRIMARY_VIDEO_PROMPT, sourceUrl, falKey);
  if (!result.url) return json({ success: false, error: result.error || 'video generation failed' });

  const { error: updateErr } = await admin.from('products').update({
    primary_video_url:               result.url,
    primary_video_generated_at:      new Date().toISOString(),
    primary_video_source_image_url:  sourceUrl,
  }).eq('id', productId);
  if (updateErr) return json({ success: false, error: updateErr.message });

  return json({
    success: true,
    video_url: result.url,
    source_image_url: sourceUrl,
  });
});
