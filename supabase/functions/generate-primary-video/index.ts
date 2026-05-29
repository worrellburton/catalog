// generate-primary-video
//
// Async pipeline: submits to fal's queue endpoint with a webhook URL and
// returns immediately with the request_id. The fal-webhook edge function
// receives fal's POST when the clip finishes (60-150s later) and writes
// primary_video_url back to the product row. This avoids Supabase Edge
// Functions' 150s gateway timeout that was killing every sync Seedance
// call.
//
// Pipeline:
//   1. Validate auth (admin or service-role)
//   2. Load product + editable prompt
//   3. POST to queue.fal.run/<seedance>?fal_webhook=<our-webhook>
//   4. Save products.primary_video_request_id + primary_video_status='pending'
//   5. Return { success: true, request_id, status: 'pending' } in <2s
//
// On webhook completion (fal-webhook):
//   - status='done' + primary_video_url set + primary_video_generated_at
//   - status='failed' on Fal error
//
// POST { product_id: string }
// → 200 { success: true, request_id, status: 'pending' }
//   or { success: false, error }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

const FAL_QUEUE_BASE = 'https://queue.fal.run';
const SEEDANCE_SLUG = 'bytedance/seedance-2.0/image-to-video';
// Submit-only call should always return in <2s; if fal's queue gateway
// is slow we still want to give the admin a response, not a timeout.
const FAL_SUBMIT_TIMEOUT_MS = 15_000;

const PRIMARY_VIDEO_PROMPT_KEY = 'prompt_primary_video';
const DEFAULT_PRIMARY_VIDEO_PROMPT = [
  'Use this exact image as the first frame.',
  'Static shot, show subtle cinematic motion of the product.',
  'If a person is in frame, keep their mouth fully closed — they must not speak, mouth words, or move their lips.',
  'Portrait composition.',
].join(' ');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

interface FalSubmitResult { request_id: string | null; error: string | null }

async function submitSeedance(prompt: string, imageUrl: string, falKey: string, webhookUrl: string): Promise<FalSubmitResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FAL_SUBMIT_TIMEOUT_MS);
  const url = `${FAL_QUEUE_BASE}/${SEEDANCE_SLUG}?fal_webhook=${encodeURIComponent(webhookUrl)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        image_url: imageUrl,
        // Seedance enum: auto | 21:9 | 16:9 | 4:3 | 1:1 | 3:4 | 9:16.
        // 3:4 matches the polished primary image — no crop/letterbox.
        aspect_ratio: '3:4',
        resolution: '720p',
        duration: '5',
        generate_audio: false,
      }),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as { name?: string })?.name === 'AbortError') return { request_id: null, error: `submit_timeout_${FAL_SUBMIT_TIMEOUT_MS}ms` };
    return { request_id: null, error: `network_error:${String(err).slice(0, 200)}` };
  }
  clearTimeout(timer);
  const text = await res.text().catch(() => '');
  if (!res.ok) return { request_id: null, error: `fal_${res.status}:${text.slice(0, 300)}` };
  let parsed: { request_id?: string };
  try { parsed = JSON.parse(text) as { request_id?: string }; } catch { return { request_id: null, error: 'fal_bad_json' }; }
  if (!parsed.request_id) return { request_id: null, error: 'fal_no_request_id' };
  return { request_id: parsed.request_id, error: null };
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
  } catch { /* fall through */ }
  if (!isServiceRole) {
    const { data: { user: caller } } = await admin.auth.getUser(token);
    if (!caller) return json({ success: false, error: 'unauthorized' }, 401);
    const { data: prof } = await admin.from('profiles').select('is_admin, role').eq('id', caller.id).maybeSingle();
    const isAdmin = prof?.is_admin === true || prof?.role === 'admin' || prof?.role === 'super_admin';
    if (!isAdmin) return json({ success: false, error: 'admin only' }, 403);
  }

  let body: { product_id?: string };
  try { body = await req.json(); } catch { return json({ success: false, error: 'JSON body required' }); }
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

  let videoPrompt = DEFAULT_PRIMARY_VIDEO_PROMPT;
  try {
    const { data: setting } = await admin
      .from('app_settings').select('value').eq('key', PRIMARY_VIDEO_PROMPT_KEY).maybeSingle();
    const v = (setting?.value as string | null)?.trim();
    if (v) videoPrompt = v;
  } catch { /* keep default */ }

  // Submit to the queue with a webhook back to our fal-webhook fn.
  // The webhook fires when the clip is ready (60-150s later) and
  // writes primary_video_url + status='done' on the products row.
  const webhookUrl = `${supabaseUrl}/functions/v1/fal-webhook`;
  const submit = await submitSeedance(videoPrompt, sourceUrl, falKey, webhookUrl);
  if (!submit.request_id) return json({ success: false, error: submit.error || 'submit failed' });

  const { error: updateErr } = await admin.from('products').update({
    primary_video_request_id:        submit.request_id,
    primary_video_status:            'pending',
    primary_video_source_image_url:  sourceUrl,
  }).eq('id', productId);
  if (updateErr) return json({ success: false, error: updateErr.message });

  return json({ success: true, request_id: submit.request_id, status: 'pending' });
});
