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
// Seedance 2 reference-to-video model slugs in priority order. We
// walk this list at submit time and use the first slug Fal accepts.
//
// Why a list: the /fast variant historically accepted up to 9 reference
// images, but on Apr 30 2026 Fal/Bytedance silently changed routing on
// /fast so multi-image payloads started bouncing with
// partner_validation_failed even though the same payload worked
// Apr 25-29. The /pro and /reference-to-video slugs used to 404 at the
// worker but Fal may have shipped them since — try those first now,
// fall back to /fast as the safety net.
const MODEL_SLUGS: string[] = [
  'bytedance/seedance-2.0/pro/reference-to-video',
  'bytedance/seedance-2.0/reference-to-video',
  'bytedance/seedance-2.0/fast/reference-to-video',
];
const MODEL_SLUG_FAST = 'bytedance/seedance-2.0/fast/reference-to-video';

async function tryFal(
  modelSlug: string,
  prompt: string,
  referenceImageUrls: string[],
  durationSeconds: number,
  falKey: string,
  webhookUrl: string,
): Promise<{ status: number; request_id: string | null; error: string | null }> {
  const submit = await fetch(
    `${FAL_BASE}/${modelSlug}?fal_webhook=${encodeURIComponent(webhookUrl)}`,
    {
      method: 'POST',
      headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        // Each reference image is addressed by @Image1, @Image2 …
        // inside the prompt; up to 9 are supported.
        image_urls: referenceImageUrls.slice(0, 9),
        // /fast caps at 5; Pro can do 5 or 10 when it works.
        duration: durationSeconds === 10 ? '10' : '5',
        aspect_ratio: '9:16',
        resolution: '720p',
        generate_audio: false,
      }),
    },
  );
  if (!submit.ok) {
    const text = await submit.text();
    console.error('[generate-look] Fal submit rejected', submit.status, text);
    return { status: submit.status, request_id: null, error: `${submit.status} ${text.slice(0, 400)}` };
  }
  const submitData = await submit.json() as { request_id?: string };
  if (!submitData.request_id) {
    return { status: submit.status, request_id: null, error: 'Fal did not return a request_id' };
  }
  return { status: submit.status, request_id: submitData.request_id, error: null };
}

async function submitFal(
  prompt: string,
  referenceImageUrls: string[],
  wantsPro: boolean,
  _durationSeconds: number,
  falKey: string,
  webhookUrl: string,
): Promise<{ request_id: string | null; model_slug: string; error: string | null; fellBack: boolean }> {
  // Walk MODEL_SLUGS top to bottom. A 404 from a worker means the slug
  // isn't routed at Fal — keep trying. Anything else (200 with a
  // request_id, or a 4xx from a slug that *is* routed) ends the loop
  // because we want one definitive submit per generation. Most rows
  // will land on the first slug once Fal ships /pro; until then we
  // burn one round-trip each before falling back to /fast.
  const errors: string[] = [];
  for (const slug of MODEL_SLUGS) {
    const r = await tryFal(slug, prompt, referenceImageUrls, 5, falKey, webhookUrl);
    if (r.request_id) {
      const fellBack = wantsPro && slug === MODEL_SLUG_FAST;
      console.log('[generate-look] submit accepted by', slug);
      return { request_id: r.request_id, model_slug: slug, error: null, fellBack };
    }
    // 404 = slug isn't routed at the worker. Move on quietly. Anything
    // else (e.g. a real validation error) we surface and bail — no
    // point trying every slug if Fal is rejecting the *content*.
    if (r.status === 404) {
      console.log('[generate-look] slug not routed', slug);
      errors.push(`${slug}: 404`);
      continue;
    }
    errors.push(`${slug}: ${r.error}`);
    return { request_id: null, model_slug: slug, error: `Fal submit failed: ${r.error}`, fellBack: wantsPro };
  }
  return {
    request_id: null,
    model_slug: MODEL_SLUG_FAST,
    error: `Fal submit failed across all slugs: ${errors.join(' | ')}`,
    fellBack: wantsPro,
  };
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
  const productsUsedRaw = productEntries.slice(0, productSlots);

  // Hosts that reliably make Fal's image fetcher 500. Google Shopping
  // thumbnail URLs (`encrypted-tbnN.gstatic.com/shopping?q=tbn:…`) pass
  // a HEAD pre-check but fail when Fal does the real GET, killing the
  // whole job. Drop them up front so the same product gets ingested
  // through the scrape path and re-uploaded to Supabase storage.
  const BLOCKED_IMAGE_HOSTS: RegExp[] = [
    /(^|\.)encrypted-tbn\d+\.gstatic\.com$/i,
    /(^|\.)tbn\d+\.gstatic\.com$/i,
    /(^|\.)googleusercontent\.com$/i, // Google Shopping mirror
  ];

  function isHostBlocked(url: string): boolean {
    try {
      const h = new URL(url).hostname;
      return BLOCKED_IMAGE_HOSTS.some(rx => rx.test(h));
    } catch { return true; }
  }

  // Pre-flight every reference URL. Reject blocked hosts up front;
  // for everything else, HEAD-check that the response is an actual
  // image of reasonable size. Drop products that fail rather than
  // killing the whole job — face photos are required so we surface a
  // hard error if any of those bounce.
  //
  // HEIC/HEIF is rejected explicitly: Fal/Seedance can't decode it and
  // returns partner_validation_failed for the whole job. iPhones default
  // to HEIC, so legacy uploads in the bucket from before the client-side
  // guard landed will hit this branch.
  function isHeicUrl(url: string, contentType: string): boolean {
    if (contentType === 'image/heic' || contentType === 'image/heif') return true;
    try {
      const path = new URL(url).pathname.toLowerCase();
      return path.endsWith('.heic') || path.endsWith('.heif');
    } catch { return false; }
  }

  // 16-bit-per-channel PNGs (iPhone HDR screenshots saved at 1179×2556
  // are the canonical case) also trigger partner_validation_failed. Sniff
  // the IHDR chunk: 8-byte PNG signature + 4-byte length + 4-byte type
  // ("IHDR") + 4-byte width + 4-byte height puts bit-depth at offset 24.
  // Anything > 8 we reject.
  async function isPng16Bit(url: string): Promise<boolean> {
    try {
      const r = await fetch(url, { headers: { Range: 'bytes=0-32' } });
      if (!r.ok) return false;
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length < 25) return false;
      const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
      if (!isPng) return false;
      return buf[24] > 8;
    } catch {
      return false;
    }
  }

  async function isImageUrlOk(url: string): Promise<boolean> {
    if (isHostBlocked(url)) return false;
    try {
      const r = await fetch(url, { method: 'HEAD', redirect: 'follow' });
      if (!r.ok) return false;
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      if (ct && !ct.startsWith('image/')) return false;
      if (isHeicUrl(url, ct)) return false;
      const len = Number(r.headers.get('content-length') || '0');
      if (len > 30 * 1024 * 1024) return false; // Fal cap is 30 MB per image
      if (ct === 'image/png' && await isPng16Bit(url)) return false;
      return true;
    } catch {
      return false;
    }
  }

  const faceChecks = await Promise.all(facesUsed.map(isImageUrlOk));
  const badFaceCount = faceChecks.filter(ok => !ok).length;
  if (badFaceCount === facesUsed.length) {
    const allHeic = facesUsed.every(u => isHeicUrl(u, ''));
    const message = allHeic
      ? 'Your photo is in HEIC format, which we can’t use. Please re-upload as JPEG or PNG.'
      : 'All reference photos failed to load — please re-upload.';
    await admin.from('user_generations').update({
      status: 'failed',
      error: message,
      completed_at: new Date().toISOString(),
    }).eq('id', generationId);
    return jsonRes({ error: message }, 400);
  }
  const goodFaces = facesUsed.filter((_, i) => faceChecks[i]);

  const productChecks = await Promise.all(productsUsedRaw.map(p => isImageUrlOk(p.image_url)));
  const productsUsed = productsUsedRaw.filter((_, i) => productChecks[i]);
  const droppedProducts = productsUsedRaw.length - productsUsed.length;

  const referenceUrls = [...goodFaces, ...productsUsed.map(p => p.image_url)];
  // Recompute slot counts after dropping bad URLs so the @ImageN tags
  // in the prompt line up with the actual reference order Fal sees.
  const goodFaceSlots = goodFaces.length;
  if (badFaceCount > 0 || droppedProducts > 0) {
    console.log('[generate-look] dropped references for gen=', generationId, {
      bad_faces: badFaceCount,
      dropped_products: droppedProducts,
      remaining: referenceUrls.length,
    });
  }

  // Build the tagged prompt. @Image1 is always the subject's face.
  // Height + age clauses dial in the body proportions and apparent age
  // so Seedance composes the subject in the right range rather than
  // guessing from the face photo alone.
  const faceTags = goodFaces.map((_, i) => `@Image${i + 1}`).join(' and ');
  // Drop brand + product names from the per-reference clauses for the
  // same reason buildGenerationPrompt drops them on the client side:
  // Bytedance/Seedance partner_validation_failed fires on prompts that
  // mention specific commercial brands or trademarked product titles.
  const productClauses = productsUsed.map((p, i) =>
    `${p.role.toLowerCase()} (@Image${goodFaceSlots + i + 1})`,
  );
  const styleSuffix = gen.style ? `, ${String(gen.style).toLowerCase()} vibe` : '';
  const heightClause = gen.height_label ? `Make them ${gen.height_label} tall.` : '';
  const ageClause = gen.age_label ? `They look ${gen.age_label}.` : '';
  const wantsPro = gen.model === 'pro';
  // /fast caps at 5s regardless of what was requested. We always
  // route reference-to-video through /fast (Pro doesn't ship for
  // this variant), so clamp to 5.
  const durationSeconds = 5;
  // Scrub brand-trademarked names from any client-supplied prompt so
  // Bytedance's partner_validation_failed filter doesn't kill the job.
  // Older client bundles shipped patterns like:
  //   1. Parenthetical product annotations: "hat (Alo Yoga Velvet Cap)".
  //   2. Naked brand mentions in the commercial-style fallback path:
  //      "...meshing Alo Yoga house-style spot ... meshing Thursday
  //      house-style spot ..."
  // Build the strip-list dynamically from the products actually picked
  // for THIS generation. That covers every brand a shopper might see,
  // not just a curated list we'd have to keep in sync. Still keep a
  // hardcoded baseline so prompts that name brands the shopper didn't
  // pick (e.g. inspirational mentions) get scrubbed too.
  const STATIC_BRAND_STRIP: RegExp[] = [
    /\bnike\b/gi, /\badidas\b/gi, /\blululemon\b/gi, /\bunder\s*armour\b/gi,
    /\bpuma\b/gi, /\breebok\b/gi, /\bgap\b/gi, /\blevi'?s?\b/gi,
    /\bralph\s*lauren\b/gi, /\bbrooks\s*brothers\b/gi, /\btommy\s*hilfiger\b/gi,
    /\blacoste\b/gi, /\buniqlo\b/gi, /\bzara\b/gi, /\bh&m\b/gi, /\bhennes\b/gi,
    /\bpatagonia\b/gi, /\bnorth\s*face\b/gi, /\bcolumbia\b/gi,
  ];
  function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  const dynamicBrands = Array.from(new Set(
    productsUsedRaw
      .map(p => (p.label || '').split(' ')[0])
      .filter(s => s && s.length > 1 && /^[a-z]/i.test(s)),
  ));
  // Also scrub the full brand strings (handles two-word brands like
  // "Alo Yoga", "Thursday Boots", "Rag & Bone").
  const dynamicBrandPhrases = Array.from(new Set(
    productLinks?.map(r => {
      const p = r.products as unknown as { brand: string | null } | null;
      return (p?.brand || '').trim();
    }).filter((s): s is string => !!s && s.length > 1) ?? [],
  ));
  const DYNAMIC_BRAND_STRIP: RegExp[] = [
    ...dynamicBrandPhrases.map(b => new RegExp(`\\b${escapeRegex(b)}\\b`, 'gi')),
    ...dynamicBrands.map(b => new RegExp(`\\b${escapeRegex(b)}\\b`, 'gi')),
  ];

  function stripBrandAnnotations(p: string): string {
    let out = p.replace(/\s*\([^)]*\)/g, '');
    for (const rx of STATIC_BRAND_STRIP) out = out.replace(rx, '');
    for (const rx of DYNAMIC_BRAND_STRIP) out = out.replace(rx, '');
    // Collapse "× × ×" / "  / " / dangling hyphens / multi-spaces left
    // behind by the strip so the final prompt reads cleanly.
    out = out.replace(/×+/g, '×').replace(/\s+×\s+/g, ' ').replace(/\s+\/\s+/g, ' / ');
    out = out.replace(/\s*-\s*([,.])/g, '$1').replace(/\s+/g, ' ').trim();
    return out;
  }
  const rawClientPrompt = (typeof gen.prompt === 'string' && gen.prompt.trim().length > 0)
    ? stripBrandAnnotations(gen.prompt)
    : null;
  const fallbackPrompt = [
    `Use the person from ${faceTags} as the subject — preserve their face, hair, and skin tone exactly.`,
    heightClause,
    ageClause,
    productClauses.length > 0
      ? `Dress them in: ${productClauses.join(', ')}. Match the colors and silhouette of each reference garment.`
      : 'Dress them in the provided products.',
    `Natural full-body motion, ${durationSeconds}-second portrait clip${styleSuffix}.`,
  ].filter(Boolean).join(' ');
  // Always re-prepend the @ImageN binding lines so Seedance binds
  // each reference photo to its tag even when the client supplied
  // a fully-formed prompt without them.
  const taggedPrompt = rawClientPrompt
    ? `Use the person from ${faceTags} as the subject — preserve their face, hair, and skin tone exactly.${productClauses.length > 0 ? ` References: ${productClauses.join(', ')}.` : ''} ${rawClientPrompt}`
    : fallbackPrompt;

  // Webhook: Fal POSTs the result to /functions/v1/fal-webhook when
  // done. We don't poll. The fal-webhook function flips the row's
  // status. Lock the row as generating *only after* Fal accepts the
  // submit so we don't strand it if the submit itself fails.
  const webhookUrl = `${supabaseUrl}/functions/v1/fal-webhook`;
  // Log the exact payload being sent so when the async webhook fires
  // back partner_validation_failed minutes later we can correlate the
  // failure to the inputs we shipped. The /generate-look HTTP call has
  // already returned 200 by then so this is the only paper trail.
  console.log('[generate-look] submitting gen=', generationId, JSON.stringify({
    prompt: taggedPrompt,
    image_urls: referenceUrls,
    duration: durationSeconds,
    style: gen.style,
    height: gen.height_label,
    age: gen.age_label,
    model: gen.model,
  }).slice(0, 1500));
  const { request_id, model_slug, error, fellBack } = await submitFal(
    taggedPrompt, referenceUrls, wantsPro, durationSeconds, falKey, webhookUrl,
  );
  if (fellBack) {
    console.log('[generate-look] gen=', generationId, 'requested pro, fell back to fast');
  }

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
    // Record which Seedance variant ran the job — useful when
    // diagnosing fast-vs-pro behavior differences.
    veo_model: model_slug,
  }).eq('id', generationId);

  return jsonRes({ success: true, request_id });
});
