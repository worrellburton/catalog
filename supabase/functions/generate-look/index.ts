// Edge function — generate-look
//
// Accepts { generation_id } POST from the authenticated shopper. Pulls
// the queued user_generations row (+ uploaded face photos and picked
// products), submits the job to Fal's Seedance 2 reference-to-video
// endpoint with a webhook URL, saves the request_id, and returns
// immediately. Fal POSTs to the fal-webhook function when the job
// finishes — that's what flips status='generating' → 'done'|'failed'.
//
// We used to poll Fal synchronously inside this function, but Seedance
// 2 with multiple references averages 160-200s and our 180s polling
// ceiling kept killing requests Fal was about to complete. Now this
// function exits in seconds.
//
// Environment:
//   FAL_KEY                       — Fal AI API key (required)
//   SUPABASE_URL                  — project URL
//   SUPABASE_SERVICE_ROLE_KEY     — service-role client for status
//                                   writes regardless of RLS

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
const MODEL_SLUG = 'bytedance/seedance-2.0/fast/reference-to-video';

async function submitFal(
  prompt: string,
  referenceImageUrls: string[],
  falKey: string,
  webhookUrl: string,
): Promise<{ request_id: string | null; error: string | null }> {
  const submit = await fetch(
    `${FAL_BASE}/${MODEL_SLUG}?fal_webhook=${encodeURIComponent(webhookUrl)}`,
    {
      method: 'POST',
      headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        // Seedance 2's reference-to-video field is `image_urls` (the
        // previous `reference_image_urls` from v1 is silently ignored,
        // which is why the face wasn't preserved — the model was
        // running text-only). Each image is addressed by @Image1,
        // @Image2, … inside the prompt; up to 9 are supported.
        image_urls: referenceImageUrls.slice(0, 9),
        duration: '5',
        aspect_ratio: '9:16',
        resolution: '720p',
        generate_audio: false,
      }),
    },
  );
  if (!submit.ok) {
    const text = await submit.text();
    return { request_id: null, error: `Fal submit failed: ${submit.status} ${text.slice(0, 200)}` };
  }
  const submitData = await submit.json() as { request_id?: string };
  if (!submitData.request_id) {
    return { request_id: null, error: 'Fal did not return a request_id' };
  }
  return { request_id: submitData.request_id, error: null };
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

  // Auth: prefer the bearer JWT, but fall back to the row's user_id
  // when the token is anon / expired. supabase-js `functions.invoke`
  // attaches whatever Authorization the client has at call time;
  // during the just-after-SSO / session-refresh window it can ship the
  // anon key, which makes auth.getUser return null. The row was
  // inserted under RLS by an authed client so its user_id is
  // trustworthy, and the status='pending' gate below stops anyone
  // from replaying a finished generation.
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '') ?? '';
  const tokenAuth = await admin.auth.getUser(token);
  const tokenUserId = tokenAuth.data.user?.id;

  const { data: gen, error: genErr } = await admin
    .from('user_generations').select('*').eq('id', generationId).single();
  if (genErr || !gen) return jsonRes({ error: 'Generation not found' }, 404);
  if (tokenUserId && tokenUserId !== gen.user_id) {
    return jsonRes({ error: 'Unauthorized' }, 401);
  }
  if (gen.status !== 'pending') return jsonRes({ error: `Generation already ${gen.status}` }, 409);

  if (!falKey) {
    await admin.from('user_generations').update({
      status: 'failed',
      error: 'FAL_KEY secret missing on Supabase project',
      completed_at: new Date().toISOString(),
    }).eq('id', generationId);
    return jsonRes({ error: 'FAL_KEY not configured' }, 500);
  }

  // Gather inputs. Face photos go first so they're addressed as
  // @Image1 (and @Image2 if the user uploaded multiple) — Seedance 2's
  // fidelity to a person depends almost entirely on the prompt naming
  // the right @ImageN as the subject. Products follow as @Image2/3/…
  // and are tagged by role so the model knows what slot each fills.
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

  // Cap at 9 (Seedance 2 limit). Face photos are non-negotiable.
  const faceSlots = Math.min(faceUrls.length, 9);
  const productSlots = Math.max(0, Math.min(9 - faceSlots, productEntries.length));
  const facesUsed = faceUrls.slice(0, faceSlots);
  const productsUsed = productEntries.slice(0, productSlots);
  const referenceUrls = [...facesUsed, ...productsUsed.map(p => p.image_url)];

  // Build the tagged prompt. @Image1 is always the subject's face.
  // Height + age clauses dial in the body proportions and apparent age
  // so Seedance composes the subject in the right range rather than
  // guessing from the face photo alone.
  const faceTags = facesUsed.map((_, i) => `@Image${i + 1}`).join(' and ');
  const productClauses = productsUsed.map((p, i) =>
    `${p.role.toLowerCase()} (@Image${faceSlots + i + 1}, ${p.label})`,
  );
  const styleSuffix = gen.style ? `, ${String(gen.style).toLowerCase()} vibe` : '';
  const heightClause = gen.height_label ? `Make them ${gen.height_label} tall.` : '';
  const ageClause = gen.age_label ? `They look ${gen.age_label}.` : '';
  const taggedPrompt = [
    `Use the person from ${faceTags} as the subject — preserve their face, hair, and skin tone exactly.`,
    heightClause,
    ageClause,
    productClauses.length > 0
      ? `Dress them in: ${productClauses.join(', ')}. Match the colors, silhouette, and details of each reference garment.`
      : 'Dress them in the provided products.',
    `Natural full-body motion, 5-second portrait clip${styleSuffix}.`,
  ].filter(Boolean).join(' ');

  // Webhook: Fal POSTs the result to /functions/v1/fal-webhook when
  // done. We don't poll. The fal-webhook function flips the row's
  // status. Lock the row as generating *only after* Fal accepts the
  // submit so we don't strand it if the submit itself fails.
  const webhookUrl = `${supabaseUrl}/functions/v1/fal-webhook`;
  const { request_id, error } = await submitFal(taggedPrompt, referenceUrls, falKey, webhookUrl);

  if (error || !request_id) {
    await admin.from('user_generations').update({
      status: 'failed',
      error: error || 'Fal submit produced no request_id',
      completed_at: new Date().toISOString(),
    }).eq('id', generationId);
    return jsonRes({ success: false, error });
  }

  await admin.from('user_generations').update({
    status: 'generating',
    fal_request_id: request_id,
    veo_model: MODEL_SLUG,
  }).eq('id', generationId);

  return jsonRes({ success: true, request_id });
});
