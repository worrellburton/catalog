// Edge function — generate-look
//
// Accepts { generation_id } POST from the authenticated shopper. Pulls the
// queued user_generations row (+ uploaded face photos and picked products),
// assembles inputs for Fal's Seedance "pro" model, polls until it finishes,
// and writes the final video_url back to the row.
//
// Environment:
//   FAL_KEY                       — Fal AI API key (required)
//   SUPABASE_URL                  — project URL
//   SUPABASE_SERVICE_ROLE_KEY     — for the service-role client that writes
//                                   back the result regardless of RLS.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

const FAL_BASE = 'https://queue.fal.run';
// Seedance 2 Fast via fal.ai — reference-to-video endpoint. We send the
// shopper's face photos + the product images as *references* (not first
// frames) so the model composes a fresh clip where the subject wears the
// picked products; first-frame image-to-video was locking the output into
// the static reference pose, which we specifically don't want here.
const MODEL_SLUG = 'bytedance/seedance-2.0/fast/reference-to-video';

async function callFal(
  prompt: string,
  referenceImageUrls: string[],
  falKey: string,
): Promise<{ video_url: string | null; error: string | null }> {
  const submit = await fetch(`${FAL_BASE}/${MODEL_SLUG}`, {
    method: 'POST',
    headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      // reference_image_urls: Seedance 2 treats these as style/subject
      // references rather than as the literal first frame.
      reference_image_urls: referenceImageUrls.slice(0, 7),
      duration: '5',
      aspect_ratio: '9:16',
      resolution: '720p',
      generate_audio: false,
    }),
  });
  if (!submit.ok) {
    const text = await submit.text();
    return { video_url: null, error: `Fal submit failed: ${submit.status} ${text.slice(0, 200)}` };
  }
  const submitData = await submit.json() as { request_id?: string; status_url?: string; response_url?: string };
  if (!submitData.request_id) {
    return { video_url: null, error: 'Fal did not return a request_id' };
  }
  const statusUrl = submitData.status_url || `${FAL_BASE}/${MODEL_SLUG}/requests/${submitData.request_id}/status`;
  const responseUrl = submitData.response_url || `${FAL_BASE}/${MODEL_SLUG}/requests/${submitData.request_id}`;

  // Poll — Seedance typically completes inside 90s.
  const start = Date.now();
  const timeoutMs = 180_000;
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 4000));
    const statusRes = await fetch(statusUrl, { headers: { Authorization: `Key ${falKey}` } });
    if (!statusRes.ok) continue;
    const statusData = await statusRes.json() as { status?: string; queue_position?: number };
    if (statusData.status === 'COMPLETED') {
      const outRes = await fetch(responseUrl, { headers: { Authorization: `Key ${falKey}` } });
      if (!outRes.ok) return { video_url: null, error: 'Fal completion fetch failed' };
      const out = await outRes.json() as { video?: { url?: string }; videos?: Array<{ url?: string }> };
      const url = out.video?.url || out.videos?.[0]?.url || null;
      return { video_url: url, error: url ? null : 'No video in Fal response' };
    }
    if (statusData.status === 'FAILED') return { video_url: null, error: 'Fal reported FAILED' };
  }
  return { video_url: null, error: 'Fal polling timed out after 3 minutes' };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonRes({ error: 'Use POST' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const falKey = Deno.env.get('FAL_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return jsonRes({ error: 'Supabase env missing' }, 500);

  let body: { generation_id?: string };
  try { body = await req.json(); } catch { return jsonRes({ error: 'Invalid JSON' }, 400); }
  const generationId = body.generation_id;
  if (!generationId) return jsonRes({ error: 'generation_id required' }, 400);

  const admin = createClient(supabaseUrl, serviceKey);

  // Verify the caller owns the row, then pull everything we need.
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '') ?? '';
  const { data: { user }, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !user) return jsonRes({ error: 'Unauthorized' }, 401);

  const { data: gen, error: genErr } = await admin
    .from('user_generations').select('*').eq('id', generationId).eq('user_id', user.id).single();
  if (genErr || !gen) return jsonRes({ error: 'Generation not found' }, 404);
  if (gen.status !== 'pending') return jsonRes({ error: `Generation already ${gen.status}` }, 409);

  // Lock the row as generating before we start calling Fal.
  await admin.from('user_generations').update({ status: 'generating' }).eq('id', generationId);

  if (!falKey) {
    await admin.from('user_generations').update({
      status: 'failed',
      error: 'FAL_KEY secret missing on Supabase project',
      completed_at: new Date().toISOString(),
    }).eq('id', generationId);
    return jsonRes({ error: 'FAL_KEY not configured' }, 500);
  }

  // Gather inputs. First face photo is the reference image Fal uses; the
  // prompt already has product roles + height + style baked in from the
  // frontend (buildGenerationPrompt).
  const { data: uploadLinks } = await admin
    .from('user_generation_uploads')
    .select('upload_id, sort_order, user_uploads(public_url)')
    .eq('generation_id', generationId)
    .order('sort_order');
  const faceUrls = (uploadLinks || []).map(r => (r.user_uploads as unknown as { public_url: string } | null)?.public_url).filter(Boolean) as string[];
  if (faceUrls.length === 0) {
    await admin.from('user_generations').update({ status: 'failed', error: 'No face photos attached' }).eq('id', generationId);
    return jsonRes({ error: 'No face photos' }, 400);
  }

  const { data: productLinks } = await admin
    .from('user_generation_products')
    .select('role_tag, sort_order, products(name, brand, image_url)')
    .eq('generation_id', generationId)
    .order('sort_order');
  const productImageUrls = (productLinks || [])
    .map(r => (r.products as unknown as { image_url: string | null } | null)?.image_url)
    .filter(Boolean) as string[];

  // Seedance 2 Fast reference-to-video accepts up to 7 reference images; we
  // stack the face photo(s) first so the model treats that as the subject
  // identity, followed by the product images as styling references.
  const referenceUrls = [...faceUrls, ...productImageUrls];

  const { video_url, error } = await callFal(gen.prompt || '', referenceUrls, falKey);

  await admin.from('user_generations').update({
    status: error ? 'failed' : 'done',
    video_url,
    veo_model: MODEL_SLUG,
    error,
    completed_at: new Date().toISOString(),
  }).eq('id', generationId);

  return jsonRes({ success: !error, video_url, error });
});
