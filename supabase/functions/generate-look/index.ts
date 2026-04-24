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
      // Seedance 2's reference-to-video field is `image_urls` (the previous
      // `reference_image_urls` from v1 is silently ignored, which is why
      // the face wasn't preserved — the model was running text-only). Each
      // image is addressed by @Image1, @Image2, … inside the prompt; up to
      // 9 are supported.
      image_urls: referenceImageUrls.slice(0, 9),
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

  // Gather inputs. Face photos go first so they're addressed as @Image1
  // (and @Image2 if the user uploaded multiple) — Seedance 2's fidelity to
  // a person depends almost entirely on the prompt naming the right
  // @ImageN as the subject. Products follow as @Image2/3/… and are tagged
  // by role so the model knows what slot each piece fills.
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
  const productEntries = (productLinks || [])
    .map(r => {
      const p = r.products as unknown as { name: string | null; brand: string | null; image_url: string | null } | null;
      if (!p?.image_url) return null;
      const label = [p.brand, p.name].filter(Boolean).join(' ').trim() || 'product';
      return { role: r.role_tag || 'item', label, image_url: p.image_url };
    })
    .filter((x): x is { role: string; label: string; image_url: string } => !!x);

  // Cap at 9 (Seedance 2 limit). Face photos are non-negotiable, so they
  // win the slot fight when there are more than 9 inputs total.
  const faceSlots = Math.min(faceUrls.length, 9);
  const productSlots = Math.max(0, Math.min(9 - faceSlots, productEntries.length));
  const facesUsed = faceUrls.slice(0, faceSlots);
  const productsUsed = productEntries.slice(0, productSlots);
  const referenceUrls = [...facesUsed, ...productsUsed.map(p => p.image_url)];

  // Build the tagged prompt. @Image1 is always the subject's face; product
  // tags reference the role + brand/name so Seedance knows which photo
  // fills which slot ("top", "bottom", etc.).
  const faceTags = facesUsed.map((_, i) => `@Image${i + 1}`).join(' and ');
  const productClauses = productsUsed.map((p, i) =>
    `${p.role.toLowerCase()} (@Image${faceSlots + i + 1}, ${p.label})`,
  );
  const styleSuffix = gen.style ? `, ${String(gen.style).toLowerCase()} vibe` : '';
  const heightClause = gen.height_label ? `Make them ${gen.height_label} tall.` : '';
  const taggedPrompt = [
    `Use the person from ${faceTags} as the subject — preserve their face, hair, and skin tone exactly.`,
    heightClause,
    productClauses.length > 0
      ? `Dress them in: ${productClauses.join(', ')}. Match the colors, silhouette, and details of each reference garment.`
      : 'Dress them in the provided products.',
    `Natural full-body motion, 5-second portrait clip${styleSuffix}.`,
  ].filter(Boolean).join(' ');

  const { video_url, error } = await callFal(taggedPrompt, referenceUrls, falKey);

  await admin.from('user_generations').update({
    status: error ? 'failed' : 'done',
    video_url,
    veo_model: MODEL_SLUG,
    error,
    completed_at: new Date().toISOString(),
  }).eq('id', generationId);

  return jsonRes({ success: !error, video_url, error });
});
