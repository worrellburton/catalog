// Edge function — generate-look
//
// Accepts { generation_id } POST. Pulls the queued user_generations row
// (+ uploaded face photos and picked products), re-hosts every reference
// image into the `generation-refs` Supabase storage bucket (owned by us
// so Fal's worker always gets a deterministic, accessible JPEG), submits
// the job to Fal's Seedance 2 /fast reference-to-video endpoint with a
// webhook URL, saves the request_id, and returns immediately.
//
// Replacing the old HEAD pre-flight with a full fetch+re-upload eliminates
// the entire class of partner_validation_failed failures caused by CDN
// HEAD-vs-GET mismatches (Amplience, Google Shopping, external retailers)
// and ensures PNG face photos are served as JPEG to Fal.
//
// The pg_net trigger on user_generations INSERT calls this function from
// the server side — the client-side invoke in createGeneration is a
// belt-and-suspenders fallback. generate-look is idempotent: if the row
// is already past 'pending' it returns success immediately.
//
// Environment:
//   FAL_KEY                       — Fal AI API key (required)
//   SUPABASE_URL                  — project URL
//   SUPABASE_SERVICE_ROLE_KEY     — service-role client

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
// Seedance 2 fallback slugs — used when the platform model is Seedance.
const MODEL_SLUG_FAST = 'bytedance/seedance-2.0/fast/reference-to-video';
// Pro is the default tier on fal.ai — no `/pro/` path segment. The fast
// tier gets its own `/fast/` subpath; everything else routes through
// the bare endpoint.
const MODEL_SLUG_PRO  = 'bytedance/seedance-2.0/reference-to-video';
const SEEDANCE_SLUGS  = new Set([MODEL_SLUG_FAST, MODEL_SLUG_PRO, 'seedance-2', 'seedance-1-pro', 'seedance-1-lite']);
function seedanceSlugFor(model: string | null | undefined): string {
  return model === 'pro' ? MODEL_SLUG_PRO : MODEL_SLUG_FAST;
}

// Whether the given slug routes through Vidu's API (different request body).
function isViduModel(slug: string): boolean {
  return slug.startsWith('fal-ai/vidu');
}

// Whether the slug is a Veo model via fal.ai (single image_url, text-described products).
function isVeoFalModel(slug: string): boolean {
  return slug.startsWith('fal-ai/veo');
}

// Whether the slug is Google's Gemini Omni (reference-to-video). Unlike Seedance,
// whose ByteDance filter now blocks ALL real human faces, Gemini Omni accepts the
// shopper's selfie — so it's the default look model. Its request body differs:
// references bind inline in the prompt via <IMAGE_REF_0>, <IMAGE_REF_1>, …
// (0-indexed), and duration is an INTEGER 3–10s.
function isGeminiOmniModel(slug: string): boolean {
  return slug.startsWith('google/gemini-omni');
}

// ── Image re-hosting helpers ──────────────────────────────────────────────────

// Max bytes we'll buffer for a single reference image (15 MB — well under
// Fal's 30 MB cap but enough for any real product or selfie photo).
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
// Bucket that holds re-hosted images. Must be public so Fal can GET them.
const REF_BUCKET = 'generation-refs';

/**
 * Fetch a remote image and re-upload to the `generation-refs` bucket.
 * Returns the public URL + diagnostic stats, or null on any failure (caller
 * skips the image rather than killing the whole job).
 */
async function reHostImage(
  sourceUrl: string,
  destPath: string,
  admin: ReturnType<typeof createClient>,
): Promise<{ url: string | null; stats: Record<string, unknown> }> {
  const stats: Record<string, unknown> = { source_url: sourceUrl };
  let res: Response;
  try {
    res = await fetch(sourceUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CatalogBot/1.0)',
        'Accept': 'image/*,*/*;q=0.8',
      },
    });
  } catch (err) {
    stats.error = `fetch_threw: ${String(err)}`;
    return { url: null, stats };
  }

  stats.fetch_status = res.status;
  if (!res.ok) {
    stats.error = `non_ok_fetch_${res.status}`;
    return { url: null, stats };
  }

  const rawCt = (res.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
  stats.source_content_type = rawCt;
  if (!rawCt.startsWith('image/')) {
    stats.error = `non_image_ct:${rawCt}`;
    return { url: null, stats };
  }

  const mimeToExt: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/png':  '.png', 'image/webp': '.webp',
    'image/gif':  '.gif', 'image/avif': '.avif',
  };
  const ext = mimeToExt[rawCt] ?? '.jpg';
  const uploadPath = destPath.replace(/\.[^.]+$/, '') + ext;

  const buf = await res.arrayBuffer().catch(() => null);
  if (!buf || buf.byteLength === 0) {
    stats.error = 'empty_body';
    return { url: null, stats };
  }
  stats.bytes = buf.byteLength;
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    stats.error = `too_large_${buf.byteLength}`;
    return { url: null, stats };
  }

  // Sniff magic bytes — Fal validator rejects PNG-bytes-as-JPEG and similar.
  const u8 = new Uint8Array(buf);
  let actualFormat: string | null = null;
  if (u8[0] === 0xFF && u8[1] === 0xD8 && u8[2] === 0xFF) actualFormat = 'image/jpeg';
  else if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) actualFormat = 'image/png';
  else if (u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46) actualFormat = 'image/webp';
  else if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) actualFormat = 'image/gif';
  stats.sniffed_format = actualFormat;
  // Use sniffed mime over header — header lies more often than magic bytes.
  const finalMime = actualFormat || rawCt;
  const finalExt = mimeToExt[finalMime] ?? ext;
  const finalPath = destPath.replace(/\.[^.]+$/, '') + finalExt;
  stats.upload_mime = finalMime;
  stats.upload_path = finalPath;

  try {
    const blob = new Blob([buf], { type: finalMime });
    const { error: upErr } = await admin.storage
      .from(REF_BUCKET)
      .upload(finalPath, blob, { contentType: finalMime, upsert: true });
    if (upErr) {
      stats.error = `upload_err:${upErr.message}`;
      return { url: null, stats };
    }
  } catch (e) {
    stats.error = `upload_threw:${String(e)}`;
    return { url: null, stats };
  }

  const { data: pub } = admin.storage.from(REF_BUCKET).getPublicUrl(finalPath);
  stats.public_url = pub?.publicUrl ?? null;
  return { url: pub?.publicUrl ?? null, stats };
}

// ── Fal submission ────────────────────────────────────────────────────────────

type FalSubmitResult = { request_id: string | null; error: string | null; raw_status: number | null; raw_body: string | null };

async function falPost(url: string, body: Record<string, unknown>, falKey: string): Promise<FalSubmitResult> {
  let submit: Response;
  try {
    submit = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { request_id: null, error: `Fal network error: ${String(err)}`, raw_status: null, raw_body: null };
  }
  const rawText = await submit.text().catch(() => '');
  if (!submit.ok) {
    return { request_id: null, error: `Fal submit ${submit.status}: ${rawText.slice(0, 400)}`, raw_status: submit.status, raw_body: rawText };
  }
  let submitData: { request_id?: string };
  try { submitData = JSON.parse(rawText) as { request_id?: string }; } catch { submitData = {}; }
  if (!submitData.request_id) {
    return { request_id: null, error: 'Fal did not return a request_id', raw_status: submit.status, raw_body: rawText };
  }
  return { request_id: submitData.request_id, error: null, raw_status: submit.status, raw_body: rawText };
}

// Seedance 2 reference-to-video (ByteDance). Uses image_urls, string duration,
// generate_audio flag, and end_user_id for the content-policy own-likeness path.
async function submitToSeedance(
  modelSlug: string,
  prompt: string,
  referenceImageUrls: string[],
  durationSeconds: number,
  falKey: string,
  webhookUrl: string,
  endUserId: string | null,
): Promise<FalSubmitResult> {
  const requestBody: Record<string, unknown> = {
    prompt,
    image_urls: referenceImageUrls.slice(0, 9),
    duration: String(durationSeconds),
    aspect_ratio: '9:16',
    resolution: '720p',
    generate_audio: false,
  };
  if (endUserId) requestBody.end_user_id = endUserId;
  return falPost(`${FAL_BASE}/${modelSlug}?fal_webhook=${encodeURIComponent(webhookUrl)}`, requestBody, falKey);
}

// Vidu reference-to-video. The base fal-ai/vidu/reference-to-video endpoint
// only accepts: prompt, reference_image_urls, aspect_ratio, movement_amplitude,
// seed. duration and resolution are NOT part of the base schema — passing them
// causes a 422 Pydantic validation error. Up to 7 reference images.
async function submitToVidu(
  modelSlug: string,
  prompt: string,
  referenceImageUrls: string[],
  falKey: string,
  webhookUrl: string,
): Promise<FalSubmitResult> {
  const requestBody: Record<string, unknown> = {
    prompt,
    reference_image_urls: referenceImageUrls.slice(0, 3),
    aspect_ratio: '9:16',
  };
  return falPost(`${FAL_BASE}/${modelSlug}?fal_webhook=${encodeURIComponent(webhookUrl)}`, requestBody, falKey);
}

// Veo via fal.ai — single reference image (face photo), products described in
// prompt text only. Veo only accepts duration as '4s', '6s', or '8s'.
function snapVeoDuration(seconds: number): string {
  if (seconds <= 5) return '4s';
  if (seconds <= 7) return '6s';
  return '8s';
}

async function submitToVeoFal(
  modelSlug: string,
  prompt: string,
  faceImageUrl: string,
  durationSeconds: number,
  falKey: string,
  webhookUrl: string,
): Promise<FalSubmitResult> {
  const requestBody: Record<string, unknown> = {
    prompt,
    image_url: faceImageUrl,
    duration: snapVeoDuration(durationSeconds),
    aspect_ratio: '9:16',
  };
  return falPost(`${FAL_BASE}/${modelSlug}?fal_webhook=${encodeURIComponent(webhookUrl)}`, requestBody, falKey);
}

// Generic fal.ai submit for other models (Kling, etc.) — passes
// image_url (single) or reference_image_urls depending on the slug.
async function submitToGenericFal(
  modelSlug: string,
  prompt: string,
  referenceImageUrls: string[],
  durationSeconds: number,
  falKey: string,
  webhookUrl: string,
): Promise<FalSubmitResult> {
  // Most generic fal models use a single image_url for the first frame.
  const requestBody: Record<string, unknown> = {
    prompt,
    image_url: referenceImageUrls[0],
    duration: durationSeconds,
    aspect_ratio: '9:16',
    resolution: '720p',
  };
  return falPost(`${FAL_BASE}/${modelSlug}?fal_webhook=${encodeURIComponent(webhookUrl)}`, requestBody, falKey);
}

// Gemini Omni Flash reference-to-video (Google). Sends the real face + product
// packshots as image_urls; the prompt binds them by 0-indexed <IMAGE_REF_N> tags.
// duration is an integer 3–10s. Returns { video: { url } } (same shape the
// fal-webhook already reads).
async function submitToGeminiOmni(
  modelSlug: string,
  prompt: string,
  referenceImageUrls: string[],
  durationSeconds: number,
  falKey: string,
  webhookUrl: string,
): Promise<FalSubmitResult> {
  const requestBody: Record<string, unknown> = {
    prompt,
    image_urls: referenceImageUrls.slice(0, 9),
    aspect_ratio: '9:16',
    duration: Math.round(Math.min(Math.max(durationSeconds, 3), 10)),
  };
  return falPost(`${FAL_BASE}/${modelSlug}?fal_webhook=${encodeURIComponent(webhookUrl)}`, requestBody, falKey);
}

// ── Brand commercial tones ────────────────────────────────────────────────────

const BRAND_COMMERCIAL_TONES: { match: RegExp; key: string; tone: string; camera: string }[] = [
  { match: /\bnike\b/i,                key: 'Nike',
    tone:   'kinetic athletic spot, cinematic slow-mo + sprint, sweat + chalk, bold black-on-white captions, hero stadium or city street',
    camera: 'kinetic handheld + dolly, low-angle hero stride, whip pan into a tight close-up, snap zoom on the logo, motion-blur match cuts; sprint cadence' },
  { match: /\badidas\b/i,              key: 'Adidas',
    tone:   'street-athletic spot, three-stripe geometry, urban grit, concrete + neon, energetic crossfade',
    camera: 'low-angle Steadicam, sliding dolly past the subject, whip-pan transitions, neon rim-light flares' },
  { match: /\blululemon\b/i,           key: 'Lululemon',
    tone:   'serene studio mat spot, soft daylight, calm breath-led pacing, neutral palette',
    camera: 'slow gimbal arc, breath-paced dolly-in, rack-focus from hands to face; sustained holds, no whip cuts' },
  { match: /\bunder\s*armour\b/i,      key: 'Under Armour',
    tone:   'gritty training spot, low-key lighting, intense close-ups, locker-room blacks',
    camera: 'tight handheld, hard side-light, push-in on clenched detail, snap-cut to wide hero pose' },
  { match: /\bpuma\b/i,                key: 'Puma',
    tone:   'high-energy track spot, motion blur, vibrant primaries',
    camera: 'tracking dolly alongside motion, whip pans, color-saturated rim light, snap zoom' },
  { match: /\bralph\s*lauren\b/i,      key: 'Ralph Lauren',
    tone:   'East-Coast estate spot, polo greens + cream, golden hour Hamptons, prep choreography',
    camera: 'wide composed frame, slow gimbal arc, soft golden flare; classical pacing with one push-in' },
  { match: /\bgap\b/i,                 key: 'Gap',
    tone:   'warm Americana family spot, sunlit denim + tees, optimistic pop, casual choreography',
    camera: 'sun-flare push-in, mid-stride hero pose at frame 2, catching-the-light close-up at frame 3, slow turn-and-smile to camera' },
  { match: /\blevi'?s?\b/i,            key: "Levi's",
    tone:   'Americana denim spot, sunset gold, dust, classic blue, warehouse + open road',
    camera: 'low-angle hero stride, dust kick-up, golden-hour rim light, dolly + slow-mo step' },
  { match: /\bchanel\b/i,              key: 'Chanel',
    tone:   'Parisian luxury spot, sculptural monochrome, marble + gold, hushed elegance',
    camera: 'slow gimbal arc around the subject, hard key + soft fill, deliberate rack focus, hushed pacing' },
  { match: /\bdior\b/i,                key: 'Dior',
    tone:   'haute couture spot, painterly light, draped fabric in motion',
    camera: 'slow dolly-in, fabric-flow slow-mo, rack focus from hands to eyes, painterly chiaroscuro' },
  { match: /\bgucci\b/i,               key: 'Gucci',
    tone:   'maximalist editorial spot, jewel tones, theatrical sets, surreal pacing',
    camera: 'symmetrical wide, slow zoom-in with theatrical pause, surreal dutch tilt, lush rack focus' },
  { match: /\bprada\b/i,               key: 'Prada',
    tone:   'austere conceptual spot, hard angles, cool palette, deliberate pacing',
    camera: 'hard fluorescent key, slow lateral dolly, deliberate quarter-turn, no whip cuts' },
  { match: /\bcalvin\s*klein\b/i,      key: 'Calvin Klein',
    tone:   'minimal monochrome spot, intimate close-ups, stark loft',
    camera: 'tight handheld close-ups, hard side-light, slow dolly to mid-shot, sparse cuts via composition shift' },
  { match: /\buniqlo\b/i,              key: 'Uniqlo',
    tone:   'clean Tokyo-grid spot, primary blocks, simple geometry, calm minimal pacing',
    camera: 'static wide composed, single push-in, deliberate quarter-turn, no whip cuts' },
  { match: /\bzara\b/i,                key: 'Zara',
    tone:   'minimal editorial spot, concrete sets, monochrome wardrobe, slow turns',
    camera: 'studio dolly arc, hard side-light, slow turn-and-stare, single rack focus' },
  { match: /\bpatagonia\b/i,           key: 'Patagonia',
    tone:   'wild-outdoors spot, mountain weather, alpine grit, documentary feel',
    camera: 'handheld documentary, wind-buffeted lens, wide-to-tight pull, breath in cold air close-up' },
  { match: /\bnorth\s*face\b/i,        key: 'The North Face',
    tone:   'expedition spot, snow + rock, technical layers',
    camera: 'wide alpine drone-feel, descend to handheld follow, breath-condensation close-up' },
  { match: /\bvans\b/i,                key: 'Vans',
    tone:   'skate-park spot, daylight warehouse, handheld energy',
    camera: 'fisheye energy, low-angle handheld follow, snap pan on board flick, freeze on landing' },
  { match: /\bconverse\b/i,            key: 'Converse',
    tone:   'analog music-video spot, brick walls, low warm tungsten',
    camera: 'handheld 16mm feel, swing-pan transitions, neon-tinged rim light, jump cut on beat' },
  { match: /\bnew\s*balance\b/i,       key: 'New Balance',
    tone:   'understated dad-core spot, tarmac, warm grade',
    camera: 'patient dolly alongside, warm grain, slow-mo footstrike close-up, single push-in to mid-shot' },
  { match: /\bbalenciaga\b/i,          key: 'Balenciaga',
    tone:   'subversive luxury spot, dystopian sets, hyper-saturated color',
    camera: 'wide-anamorphic feel, slow zoom with menacing pause, hard composed frame, single drop-cut' },
  { match: /\bversace\b/i,             key: 'Versace',
    tone:   'gold-medusa Miami spot, marble columns, baroque richness',
    camera: 'slow orbit around the subject, gold-bounce key, rack focus on jewelry, slow tilt up to face' },
  { match: /\barit\s*zia\b/i,          key: 'Aritzia',
    tone:   'elevated everyday spot, soft neutrals, gauzy daylight',
    camera: 'soft window light, slow gimbal turn, rack focus from fabric to eyes, slow-mo fabric move' },
  { match: /\babercrombie\b/i,         key: 'Abercrombie',
    tone:   'sun-drenched coastal spot, pier and dunes, denim and white tees',
    camera: 'sun-flare lens, low-angle hero, ocean wind-blown hair, slow turn-to-camera' },
  { match: /\bmadewell\b/i,            key: 'Madewell',
    tone:   'lived-in denim spot, warm warehouse, hand-held intimacy',
    camera: 'warm hand-held, intimate close-up of hands on denim, slow turn to mid-shot, soft window key' },
  { match: /\bbanana\s*republic\b/i,   key: 'Banana Republic',
    tone:   'modern safari spot, neutral camel and stone, golden hour',
    camera: 'wide-to-tight push-in, golden hour flare, slow gimbal walk, classical pacing' },
  { match: /\bapple\b/i,               key: 'Apple',
    tone:   'minimalist white-room spot, clean motion, hero shot, kinetic typography',
    camera: 'static white seamless, slow turntable rotation of subject, push-in to macro detail at frame 3, clean rack-focus cut to product hero' },
];

interface BrandTone { key: string; tone: string; camera: string }

function detectBrandTones(productLines: { brand: string | null }[]): BrandTone[] {
  const seen = new Map<string, BrandTone>();
  for (const p of productLines) {
    const brand = (p.brand ?? '').trim();
    if (!brand) continue;
    const hit = BRAND_COMMERCIAL_TONES.find(b => b.match.test(brand));
    if (hit) {
      if (!seen.has(hit.key)) seen.set(hit.key, hit);
    } else if (!seen.has(brand)) {
      seen.set(brand, {
        key: brand,
        tone: 'confident brand lifestyle spot, clean aspirational setting',
        camera: 'mid-shot hero, slow gimbal arc, natural light, single rack focus',
      });
    }
  }
  return Array.from(seen.values());
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonRes({ error: 'Use POST' }, 405);

  try {
    return await handleRequest(req);
  } catch (err) {
    // Last-resort catch so the runtime never returns a 500 text/plain response.
    // Any uncaught exception (storage throws, unexpected type errors, etc.) is
    // surfaced as a JSON 500 so the client at least gets a parseable error body.
    console.error('[generate-look] unhandled exception', err);
    return jsonRes({ error: 'Internal error', detail: String(err) }, 500);
  }
});

async function handleRequest(req: Request): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const falKey = Deno.env.get('FAL_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return jsonRes({ error: 'Supabase env missing' }, 500);

  let body: { generation_id?: string };
  try { body = await req.json(); } catch { return jsonRes({ error: 'Invalid JSON' }, 400); }
  const generationId = body.generation_id;
  if (!generationId) return jsonRes({ error: 'generation_id required' }, 400);

  const admin = createClient(supabaseUrl, serviceKey);

  // Best-effort generation_events writer — never throws
  const logEvent = async (event: string, payload: Record<string, unknown>) => {
    try {
      await admin.from('generation_events')
        .insert({ generation_id: generationId, event, payload });
    } catch (e) {
      console.warn('[generate-look] logEvent failed', e);
    }
  };

  // Auth check — pg_net trigger sends a service-role Bearer so tokenUserId
  // will be null (service role tokens don't map to a user). In that case
  // we trust the generationId alone. A real user Bearer is still checked.
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
  // Idempotency: pg_net trigger and client-side invoke may both fire.
  // Only the first wins; subsequent calls return early.
  if (gen.status !== 'pending') {
    return jsonRes({ success: true, already: gen.status });
  }

  if (!falKey) {
    await admin.from('user_generations').update({
      status: 'failed',
      error: 'FAL_KEY secret missing on Supabase project',
      completed_at: new Date().toISOString(),
    }).eq('id', generationId);
    await logEvent('fal_submit_fail', { error: 'FAL_KEY missing' });
    return jsonRes({ error: 'FAL_KEY not configured' }, 500);
  }

  // ── Gather face photo URLs ─────────────────────────────────────────────────
  const { data: uploadLinks } = await admin
    .from('user_generation_uploads')
    .select('upload_id, sort_order, user_uploads(public_url)')
    .eq('generation_id', generationId)
    .order('sort_order');

  const faceSourceUrls = (uploadLinks || [])
    .map(r => (r.user_uploads as unknown as { public_url: string } | null)?.public_url)
    .filter(Boolean) as string[];

  if (faceSourceUrls.length === 0) {
    await admin.from('user_generations').update({ status: 'failed', error: 'No face photos attached' }).eq('id', generationId);
    await logEvent('fal_submit_fail', { error: 'no_face_photos' });
    return jsonRes({ error: 'No face photos' }, 400);
  }

  // ── Gather product image URLs ──────────────────────────────────────────────
  // Send ONLY the curated primary packshot per product (one image each). The
  // on-model gallery angles trip ByteDance's partner_validation content policy
  // ("likenesses of real people" — the models wearing the clothes), and one
  // clean packshot is enough to reconstruct the garment on the shopper.
  const { data: productLinks } = await admin
    .from('user_generation_products')
    .select('role_tag, sort_order, products(name, brand, image_url, primary_image_url, images, primary_image_person_free)')
    .eq('generation_id', generationId)
    .order('sort_order');

  // A Google-Shopping/SerpAPI search THUMBNAIL (encrypted-tbn*.gstatic.com,
  // serpapi.com) is tiny and often a wrong colorway — a poor image to
  // condition a video model on (this is why looks came out the wrong color).
  const isThumb = (u: string | null | undefined): boolean =>
    !!u && /gstatic\.com|serpapi\.com/.test(u);
  const galleryUrl = (it: unknown): string | null => {
    if (typeof it === 'string') return it;
    if (it && typeof it === 'object') {
      const o = it as Record<string, unknown>;
      const u = o.url ?? o.src;
      return typeof u === 'string' ? u : null;
    }
    return null;
  };
  const productEntries = (productLinks || [])
    .map(r => {
      const p = r.products as unknown as { name: string | null; brand: string | null; image_url: string | null; primary_image_url: string | null; images: unknown; primary_image_person_free: boolean | null } | null;
      // Primary packshot only. Prefer the curated primary_image_url / legacy
      // image_url; fall back to the first non-thumbnail gallery angle if a
      // product has neither. Exactly one image goes to the model per product.
      const primary =
        [p?.primary_image_url, p?.image_url].find((u): u is string => typeof u === 'string' && !!u && !isThumb(u))
        ?? (Array.isArray(p?.images) ? p!.images.map(galleryUrl).find((u): u is string => typeof u === 'string' && !!u && !isThumb(u)) : undefined)
        ?? null;
      if (!primary) return null;
      const label = [p?.brand, p?.name].filter(Boolean).join(' ').trim() || 'product';
      // Only a CONFIRMED person-free packshot is safe to send as a visual ref —
      // Seedance blocks non-consented human likenesses. on-model / unknown
      // (false / null) → the product is described in the prompt text instead.
      const personFree = p?.primary_image_person_free === true;
      return { role: r.role_tag || 'item', label, imageUrls: [primary], brand: p?.brand ?? null, personFree };
    })
    .filter((x): x is { role: string; label: string; imageUrls: string[]; brand: string | null; personFree: boolean } => !!x);

  // ── Resolve video model from platform settings ───────────────────────────
  const { data: modelSetting } = await admin
    .from('app_settings').select('value').eq('key', 'look_video_model').maybeSingle();
  // Default to Seedance reference-to-video (sees the product packshots), NOT
  // Veo image-to-video (which only sees the selfie and would drop the products).
  const platformSlug = modelSetting?.value || 'bytedance/seedance-2.0/fast/reference-to-video';
  // Fallback policy: allow the product-blind Veo face-only fallback for a
  // product look only when an operator opts in. Default false = fail loudly.
  const { data: fallbackSetting } = await admin
    .from('app_settings').select('value').eq('key', 'look_video_fallback').maybeSingle();
  const allowProductBlindFallback = fallbackSetting?.value === 'true';
  // If the platform is still set to a Seedance variant, respect the user's
  // fast/pro quality choice from gen.model; otherwise use the platform slug.
  const modelSlug = SEEDANCE_SLUGS.has(platformSlug)
    ? seedanceSlugFor(gen.model)
    : platformSlug;

  const isVeo = isVeoFalModel(modelSlug);
  const isSeedance = SEEDANCE_SLUGS.has(modelSlug);
  const isGeminiOmni = isGeminiOmniModel(modelSlug);
  // Models that take exactly ONE face image (products fill the remaining slots):
  // Veo (face only, no products), Seedance, and Gemini Omni.
  const oneFaceModel = isVeo || isSeedance || isGeminiOmni;
  // Vidu: up to 3 ref slots. Veo: 1 (face only). Others (Seedance/Gemini Omni/generic): 9.
  const maxSlots = isViduModel(modelSlug) ? 3 : (isVeo ? 1 : 9);
  // One-face models: always send exactly 1 face photo (randomly chosen from up to 3 available).
  const faceSlots = oneFaceModel ? 1 : Math.min(faceSourceUrls.length, maxSlots);
  // For Veo, no product images are sent — products are described in the prompt instead.
  const productImageBudget = isVeo ? 0 : Math.max(0, maxSlots - faceSlots);
  // One-face models: pick a random face from the first 3 available; otherwise use ordered list.
  const randomFaceIdx = oneFaceModel && faceSourceUrls.length > 1
    ? Math.floor(Math.random() * Math.min(faceSourceUrls.length, 3))
    : 0;
  const faceSourcesToUse = oneFaceModel
    ? [faceSourceUrls[randomFaceIdx]]
    : faceSourceUrls.slice(0, faceSlots);
  // Only person-free packshots go to the model as images (on-model shots trip
  // Seedance's human-likeness block); the rest are described in prompt text.
  // Flatten the eligible products' images into the reference budget, one each
  // first, then round-robin. pIdx stays the index into the FULL productEntries
  // so the prompt tags line up and the text-only products are identifiable.
  const flatProductImgs: { pIdx: number; url: string }[] = [];
  const imgEligible = productEntries
    .map((pe, pIdx) => ({ pe, pIdx }))
    .filter(x => x.pe.personFree);
  if (productImageBudget > 0 && imgEligible.length > 0) {
    const perProduct = Math.max(1, Math.floor(productImageBudget / imgEligible.length));
    for (const { pe, pIdx } of imgEligible) {
      for (const u of pe.imageUrls.slice(0, perProduct)) flatProductImgs.push({ pIdx, url: u });
    }
    let col = perProduct;
    while (flatProductImgs.length < productImageBudget) {
      let added = false;
      for (const { pe, pIdx } of imgEligible) {
        if (flatProductImgs.length >= productImageBudget) break;
        const u = pe.imageUrls[col];
        if (u) { flatProductImgs.push({ pIdx, url: u }); added = true; }
      }
      if (!added) break;
      col++;
    }
  }
  const ts = Date.now();

  await logEvent('submit_attempt', {
    face_count: faceSourcesToUse.length,
    product_count: productEntries.length,
    product_image_count: flatProductImgs.length,
    fal_model: modelSlug,
    requested_model: gen.model ?? 'fast',
  });

  // ── Re-host all reference images into generation-refs bucket ──────────────
  // Full fetch + re-upload eliminates CDN HEAD-vs-GET mismatches and serves
  // every image with the right MIME type sniffed from the magic bytes.
  const reHostedFaces = await Promise.all(
    faceSourcesToUse.map((url, i) =>
      reHostImage(url, `${generationId}/face_${i}_${ts}.jpg`, admin)
    )
  );

  await logEvent('image_rehost_faces', { stats: reHostedFaces.map(r => r.stats) });

  const goodFaceUrls = reHostedFaces.map(r => r.url).filter((u): u is string => u !== null);
  const droppedFaces = reHostedFaces.length - goodFaceUrls.length;

  if (goodFaceUrls.length === 0) {
    await admin.from('user_generations').update({
      status: 'failed',
      error: 'All reference photos failed to load — please re-upload.',
      error_code: 'face_rehost_failed',
      completed_at: new Date().toISOString(),
    }).eq('id', generationId);
    await logEvent('fal_submit_fail', { error: 'all_face_rehost_failed', dropped: droppedFaces });
    return jsonRes({ error: 'All face photos unreachable' }, 400);
  }

  const reHostedProducts = await Promise.all(
    flatProductImgs.map((f, i) =>
      reHostImage(f.url, `${generationId}/product_${i}_${ts}.jpg`, admin)
    )
  );
  await logEvent('image_rehost_products', { stats: reHostedProducts.map(r => r.stats) });
  // Keep the product-index mapping only for gallery images that survived
  // re-hosting, so prompt tags line up with the reference array.
  const goodFlatProducts = flatProductImgs
    .map((f, i) => ({ pIdx: f.pIdx, url: reHostedProducts[i].url }))
    .filter((f): f is { pIdx: number; url: string } => f.url !== null);
  const goodProductUrls = goodFlatProducts.map(f => f.url);
  const droppedProducts = reHostedProducts.length - goodProductUrls.length;
  // Distinct products that still have at least one usable angle.
  const usedProductIdxs = [...new Set(goodFlatProducts.map(f => f.pIdx))].sort((a, b) => a - b);
  const productsUsed = usedProductIdxs.map(i => productEntries[i]);

  if (droppedFaces > 0 || droppedProducts > 0) {
    await logEvent('image_preflight', {
      dropped_faces: droppedFaces,
      dropped_products: droppedProducts,
      remaining_faces: goodFaceUrls.length,
      remaining_products: goodProductUrls.length,
    });
  }

  const referenceUrls = [...goodFaceUrls, ...goodProductUrls];
  const goodFaceSlots = goodFaceUrls.length;

  // ── Build prompt ──────────────────────────────────────────────────────────
  // For Veo (single image input): products are NOT sent as visual references,
  // so we describe them in text. For other models: @Image tags index into the
  // reference_image_urls array.
  const faceTags = goodFaceUrls.map((_, i) => `@Image${i + 1}`).join(' and ');

  // Identity lock — the #1 failure mode with reference-to-video is the model
  // borrowing a FACE from a product image (product packshots are usually shot
  // ON A MODEL). Faces are always the FIRST reference slots; this clause pins
  // identity to those and tells the model the product images are garments
  // only, so it never renders the product model's face instead of the shopper.
  const identityLock = (!isVeo && goodFaceUrls.length > 0)
    ? (productsUsed.length > 0
        ? `The person's face, hair, skin tone, and body belong ONLY to ${faceTags} — this is who appears in the video. The remaining reference images are clothing swatches: copy the garments exactly, but completely IGNORE any person, face, model, or body shown wearing them.`
        : `The person's face and identity belong ONLY to ${faceTags}.`)
    : '';

  // Veo: describe every product in text (no product images sent). Other models:
  // tag each image-backed garment with its @Image slot(s), then append the
  // products that have NO safe reference image (on-model-only / unknown) as
  // text-only clauses, so the model still dresses the person in them.
  const usedIdxSet = new Set(usedProductIdxs);
  const productClauses = isVeo
    ? productEntries.map(p => `${p.label} (${p.role.toLowerCase()})`)
    : [
        ...usedProductIdxs.map(pIdx => {
          const pe = productEntries[pIdx];
          const tags = goodFlatProducts
            .map((f, i) => (f.pIdx === pIdx ? `@Image${goodFaceSlots + i + 1}` : null))
            .filter((t): t is string => t !== null)
            .join('/');
          return `${pe.role.toLowerCase()} (${tags}, ${pe.label})`;
        }),
        ...productEntries
          .map((pe, i) => ({ pe, i }))
          .filter(x => !usedIdxSet.has(x.i))
          .map(x => `${x.pe.role.toLowerCase()} (${x.pe.label})`),
      ];

  const heightClause = gen.height_label ? `Make them ${gen.height_label} tall.` : '';
  const ageClause = gen.age_label ? `They look ${gen.age_label}.` : '';
  // Duration: Seedance pro accepts 5-12s; Vidu/Veo default to 5s.
  const requestedDuration = typeof gen.duration_seconds === 'number' && gen.duration_seconds > 0 ? gen.duration_seconds : 5;
  const durationSeconds = (!isViduModel(modelSlug) && !isVeo && gen.model === 'pro')
    ? Math.min(Math.max(requestedDuration, 5), 12)
    : Math.min(requestedDuration, 8);

  let taggedPrompt: string;
  if (isVeo) {
    // Veo image-to-video: input image is the first frame. To keep the person's
    // face/identity, we anchor it explicitly. Products are described as what the
    // person IS wearing so Veo renders them as part of the existing outfit rather
    // than hallucinating a new character.
    if (typeof gen.prompt === 'string' && gen.prompt.trim().length > 0) {
      // Custom prompt: just pass it through with any product context appended.
      const wearingLine = productClauses.length > 0 ? ` Wearing: ${productClauses.join(', ')}.` : '';
      taggedPrompt = gen.prompt + wearingLine;
    } else if (productClauses.length > 0) {
      // Products selected: anchor face, describe outfit, add motion.
      const motionNote = gen.style === 'commercial'
        ? 'They shift into a confident pose — slow, deliberate brand energy.'
        : gen.style === 'editorial'
          ? 'They turn slightly and glance away — editorial stillness with one fluid motion.'
          : 'They make a slow natural movement — subtle head turn or gentle weight shift.';
      taggedPrompt = [
        `Keep the exact face, hair, and physical appearance of the person shown in the input image — same identity, do not change who they are.`,
        `They are wearing: ${productClauses.join(', ')}.`,
        motionNote,
        `Photorealistic, smooth cinematic motion. Soft directional light, shallow depth of field, gentle camera drift. Magazine-quality 9:16 portrait.`,
      ].join(' ');
    } else {
      // No products: pure animation of the photo as-is.
      const motionNote = gen.style === 'commercial'
        ? 'The subject shifts into a confident brand pose, slow deliberate movement.'
        : gen.style === 'editorial'
          ? 'The subject turns slightly and glances away, editorial stillness with one fluid motion.'
          : 'The subject makes a slow natural movement — subtle head turn or gentle body shift.';
      taggedPrompt = [
        `Animate this photo into a short cinematic video. Keep the person, outfit, and setting exactly as shown — do not change their appearance or clothing.`,
        motionNote,
        `Smooth, photorealistic motion. Soft directional light, shallow depth of field, gentle camera drift. Magazine-quality fashion editorial. 9:16 portrait.`,
      ].join(' ');
    }
  } else if (typeof gen.prompt === 'string' && gen.prompt.trim().length > 0) {
    // User wrote their own prompt — prepend only the @Image tags so the model
    // knows which slots are faces vs products. Do NOT repeat face-preservation
    // language if the user's own prompt already has it, and avoid stacking
    // face-cloning phrases that trigger ByteDance's content filter.
    taggedPrompt = [
      `Subject: ${faceTags}.`,
      identityLock,
      productClauses.length > 0
        ? `The subject must be visibly wearing ALL ${productClauses.length} of these items together in the same shot — do not omit or substitute any: ${productClauses.join('; ')}.`
        : '',
      gen.prompt,
    ].filter(Boolean).join(' ');
  } else if (gen.style === 'commercial' && productsUsed.length > 0) {
    const brandTones = detectBrandTones(productsUsed.map(p => ({ brand: p.brand ?? null })));
    const toneBlock = brandTones.length > 0
      ? brandTones.map(b => `${b.key} — ${b.tone}`).join('; ')
      : 'confident lifestyle brand spot';
    const cameraBlock = brandTones.length > 0 ? brandTones[0].camera : 'natural mid-shot, slow gimbal arc';
    taggedPrompt = [
      `Use ${faceTags} as the talent.`,
      identityLock,
      heightClause,
      ageClause,
      `Dress them in: ${productClauses.join(', ')}.`,
      `Brand world: ${toneBlock}.`,
      `Camera: ${cameraBlock}.`,
      `${durationSeconds}-second commercial clip, 9:16 portrait.`,
    ].filter(Boolean).join(' ');
  } else {
    const styleSuffix = gen.style ? `, ${String(gen.style).toLowerCase()} vibe` : '';
    taggedPrompt = [
      `Use ${faceTags} as the subject.`,
      identityLock,
      heightClause,
      ageClause,
      productClauses.length > 0
        ? `Dress them in: ${productClauses.join(', ')}. Match the colors, silhouette, and details of each reference garment.`
        : 'Dress them in the provided products.',
      `Natural full-body motion, ${durationSeconds}-second portrait clip${styleSuffix}.`,
    ].filter(Boolean).join(' ');
  }

  // ── Submit to Fal ─────────────────────────────────────────────────────────
  const webhookUrl = `${supabaseUrl}/functions/v1/fal-webhook`;
  const FALLBACK_VEO_SLUG = 'fal-ai/veo3.1/fast/image-to-video';
  let submitResult: FalSubmitResult;
  let effectiveModelSlug = modelSlug;
  if (isVeo) {
    submitResult = await submitToVeoFal(modelSlug, taggedPrompt, goodFaceUrls[0], durationSeconds, falKey, webhookUrl);
  } else if (isViduModel(modelSlug)) {
    submitResult = await submitToVidu(modelSlug, taggedPrompt, referenceUrls, falKey, webhookUrl);
  } else if (isGeminiOmni) {
    // Gemini Omni binds references inline via 0-indexed <IMAGE_REF_N> tags; reuse
    // the same prompt by remapping the @Image{k} tags → <IMAGE_REF_{k-1}>. Gemini
    // Omni renders WITH audio and will lip-sync/talk by default (there's no API
    // flag to disable audio) — force a silent, non-speaking subject via the prompt.
    const geminiPrompt = `CRITICAL IDENTITY: <IMAGE_REF_0> is a real photograph of the EXACT person who must appear in the video. Reproduce their face identically — same facial features, face shape, eyes, nose, skin tone, hair, beard, and glasses. Do NOT beautify, restyle, age, slim, or alter their face in any way; it must clearly be the same person. `
      + taggedPrompt.replace(/@Image(\d+)/g, (_m, n) => `<IMAGE_REF_${Number(n) - 1}>`)
      + ' The person simply keeps their mouth closed and does NOT speak, talk, or move their lips (no dialogue, no lip-sync) — but their face and features stay exactly as in the reference. Silent clip: no voiceover, no talking, no music.';
    submitResult = await submitToGeminiOmni(modelSlug, geminiPrompt, referenceUrls, durationSeconds, falKey, webhookUrl);
  } else if (SEEDANCE_SLUGS.has(modelSlug) || modelSlug.startsWith('bytedance/')) {
    submitResult = await submitToSeedance(modelSlug, taggedPrompt, referenceUrls, durationSeconds, falKey, webhookUrl, gen.user_id);
  } else {
    submitResult = await submitToGenericFal(modelSlug, taggedPrompt, referenceUrls, durationSeconds, falKey, webhookUrl);
  }

  // ── Veo fallback: if primary model fails, retry once with Veo Fast ────────
  // The Veo Fast fallback is a product-BLIND, face-only animation — it renders
  // the person in whatever they wore in the selfie, NOT the picked products.
  // That's correct for a no-product "animate my photo" job, but for a try-on it
  // silently produces the WRONG outfit. So we only fall back when there are no
  // products, unless an operator explicitly opts in via the look_video_fallback
  // dial. Otherwise the job fails loudly (below) and the shopper retries.
  const primaryFailed = !!(submitResult.error || !submitResult.request_id);
  const canFallback = !isVeo && modelSlug !== FALLBACK_VEO_SLUG;
  const fallbackAllowed = productsUsed.length === 0 || allowProductBlindFallback;
  if (primaryFailed && canFallback && fallbackAllowed) {
    await logEvent('fal_submit_fallback', {
      original_model: modelSlug,
      fallback_model: FALLBACK_VEO_SLUG,
      original_error: submitResult.error,
      original_raw_status: submitResult.raw_status,
      product_count: productsUsed.length,
    });
    // Build a minimal Veo-compatible prompt — animate the first frame, don't describe a new character.
    const fallbackPrompt = `Animate this photo into a short cinematic video. Keep the person, outfit, and setting exactly as shown in the image — do not change their appearance or clothing. Smooth, photorealistic motion. Soft directional light, shallow depth of field. Magazine-quality fashion editorial. 9:16 portrait.`;
    submitResult = await submitToVeoFal(FALLBACK_VEO_SLUG, fallbackPrompt, goodFaceUrls[0], durationSeconds, falKey, webhookUrl);
    if (!submitResult.error && submitResult.request_id) {
      effectiveModelSlug = FALLBACK_VEO_SLUG;
    }
  } else if (primaryFailed && canFallback && !fallbackAllowed) {
    // Deliberately NOT falling back: a product try-on would come back wrong.
    await logEvent('fal_submit_fallback_skipped', {
      reason: 'product_look_no_blind_fallback',
      original_model: modelSlug,
      original_error: submitResult.error,
      original_raw_status: submitResult.raw_status,
      product_count: productsUsed.length,
    });
  }

  const { request_id, error: falError, raw_status, raw_body } = submitResult;

  if (falError || !request_id) {
    // Shopper-facing copy stays friendly for a product try-on (the raw Fal
    // error — e.g. an exhausted balance — is kept in error_raw for admins).
    const friendly = productsUsed.length > 0
      ? "Couldn't render your look right now — please try again in a moment."
      : (falError || 'Fal submit produced no request_id');
    await admin.from('user_generations').update({
      status: 'failed',
      error: friendly,
      error_code: 'fal_submit_error',
      error_raw: falError || null,
      completed_at: new Date().toISOString(),
    }).eq('id', generationId);
    await logEvent('fal_submit_fail', {
      error: falError,
      raw_status,
      raw_body: raw_body?.slice(0, 800),
      face_count: goodFaceUrls.length,
      product_count: goodProductUrls.length,
      model: modelSlug,
      fallback_attempted: modelSlug !== effectiveModelSlug,
    });
    return jsonRes({ success: false, error: falError });
  }

  await admin.from('user_generations').update({
    status: 'generating',
    fal_request_id: request_id,
    veo_model: effectiveModelSlug,
  }).eq('id', generationId);

  await logEvent('fal_submit_ok', {
    request_id,
    model: modelSlug,
    duration_seconds: durationSeconds,
    reference_count: referenceUrls.length,
    face_count: goodFaceUrls.length,
    product_count: goodProductUrls.length,
    image_urls: referenceUrls,
    prompt_preview: taggedPrompt.slice(0, 400),
  });

  return jsonRes({ success: true, request_id });
}
