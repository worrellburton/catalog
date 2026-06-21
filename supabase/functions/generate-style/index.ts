// Edge function — generate-style
//
// POST { generation_id } with the shopper's JWT in the Authorization header.
// 1. Verifies the JWT and that the generation row belongs to the caller.
// 2. Loads profile context (gender, name, height_label, age_label).
// 3. Reads the foundational prompt from app_settings('style_prompt') and
//    substitutes {{gender}} {{name}} {{height}} {{age}} {{pronoun}} {{occasion}}
//    plus the contracted form {{pronoun}}'s → he's|she's|they're.
// 4. Seeds 4 'pending' style_generation_images rows and RETURNS IMMEDIATELY
//    with the 'generating' parent + those pending rows. The slow fal.ai work
//    runs in a background task (EdgeRuntime.waitUntil) so the client's invoke()
//    fetch isn't held open for 30-150s (which used to get killed mid-flight and
//    surface a false "Failed to send a request to the Edge Function").
// 5. In the background: submits 4 fal.ai jobs in parallel — all to
//    openai/gpt-image-2/edit — each with the user's reference photos.
//    (nano-banana-2 was removed by request; existing nano-banana-2 rows stay in
//    the DB and render historically.) Asks for 16:9 outputs so the tile grid is
//    consistent. As each completes it writes the row; when all 4 settle it
//    marks the parent style_generations row done|failed.
// 6. The client polls style_generations / style_generation_images until the
//    parent reaches done|failed, filling tiles as images land.
//
// Environment:
//   FAL_KEY                       — Fal AI key (required)
//   SUPABASE_URL                  — project URL
//   SUPABASE_SERVICE_ROLE_KEY     — service-role client for writes
//   SUPABASE_ANON_KEY             — anon key for JWT verification

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

const FAL_BASE_SYNC = 'https://fal.run';
// gpt-image-2 lives under the `openai/` provider namespace on fal
// (not `fal-ai/`), and the edit endpoint is `/edit`. We tried
// `fal-ai/gpt-image-2/edit-image` and `fal-ai/gpt-image-2/image-to-image`
// first — both returned `fal_404:Path … not found`. Verified against
// https://fal.ai/models?keywords=gpt-image: the listed editor is
// `openai/gpt-image-2/edit`.
const GPT_IMAGE_SLUG = 'openai/gpt-image-2/edit';

interface ProfileContext {
  gender: 'male' | 'female' | 'unknown';
  full_name: string | null;
  height_label: string | null;
  age_label: string | null;
}

interface GenerationRow {
  id: string;
  user_id: string;
  status: string;
  occasion: string;
  reference_urls: string[];
}

// ── Prompt substitution ───────────────────────────────────────────────────
// Process `{{pronoun}}'s` BEFORE `{{pronoun}}` so the contracted form maps
// to a grammatical "he's | she's | they're" instead of "they's".

function genderWord(g: ProfileContext['gender']): string {
  return g === 'male' ? 'guy' : g === 'female' ? 'girl' : 'person';
}

function pronounSubject(g: ProfileContext['gender']): string {
  return g === 'male' ? 'he' : g === 'female' ? 'she' : 'they';
}

function pronounContraction(g: ProfileContext['gender']): string {
  return g === 'male' ? "he's" : g === 'female' ? "she's" : "they're";
}

function resolvePrompt(template: string, profile: ProfileContext, occasion: string): string {
  const name = profile.full_name?.trim() || 'this person';
  const height = profile.height_label?.trim() || 'average height';
  const age = profile.age_label?.trim() || 'their age';
  const filled = template
    .replace(/\{\{\s*gender\s*\}\}/g, genderWord(profile.gender))
    .replace(/\{\{\s*name\s*\}\}/g, name)
    .replace(/\{\{\s*height\s*\}\}/g, height)
    .replace(/\{\{\s*age\s*\}\}/g, age)
    .replace(/\{\{\s*pronoun\s*\}\}'s/g, pronounContraction(profile.gender))
    .replace(/\{\{\s*pronoun\s*\}\}/g, pronounSubject(profile.gender))
    .replace(/\{\{\s*occasion\s*\}\}/g, occasion.trim() || 'any occasion');
  // Hard directive every run: the multiple reference photos are for
  // identity / build / face only — never reproduce them in the output.
  // Appended in the edge function (not the admin-editable template) so
  // it can't be accidentally edited away.
  return `${filled} Use the reference photos only to inform the person's appearance (face, build, hair, skin tone). Do not include the reference photos themselves in the generated style sheet — show only the new outfit references.`;
}

// ── fal.ai sync image generation ──────────────────────────────────────────

interface FalImageResult { url: string | null; error: string | null }

// Hard per-call timeout so one slow provider can't strand its row in
// `pending` forever (Supabase edge functions are killed at 60s wall
// clock — if gpt-image-2 hasn't returned by ~50s we abort and mark
// failed, leaving headroom to write the row).
const FAL_CALL_TIMEOUT_MS = 50_000;

async function callFalImage(
  modelSlug: string,
  prompt: string,
  imageUrls: string[],
  falKey: string,
): Promise<FalImageResult> {
  const body: Record<string, unknown> = {
    prompt,
    image_urls: imageUrls.slice(0, 4),
    num_images: 1,
  };
  // gpt-image-2's image_size is an enum (square_hd | square |
  // portrait_4_3 | portrait_16_9 | landscape_4_3 | landscape_16_9).
  // quality=low cuts the wall-clock cost roughly in half so all four
  // calls reliably finish under the 60s edge timeout.
  if (modelSlug.includes('gpt-image-2')) {
    body.image_size = 'landscape_16_9';
    body.quality = 'low';
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FAL_CALL_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${FAL_BASE_SYNC}/${modelSlug}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${falKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
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

// ── Background fan-out ──────────────────────────────────────────────────────
// Supabase keeps the worker alive for promises handed to EdgeRuntime.waitUntil
// even after the response is sent, so we return the seeded `pending` rows to the
// client immediately and finish the slow fal.ai work here. The client polls the
// DB and fills tiles as each image lands. (Previously the handler awaited all 4
// fal calls before responding — 30-156s — so the browser's invoke() fetch was
// killed long before the function returned, surfacing a false "Failed to send a
// request to the Edge Function" even though the generation had actually
// succeeded server-side.)

// Read EdgeRuntime off globalThis so we don't collide with (or depend on) the
// ambient Supabase type declaration.
function getEdgeWaitUntil(): ((p: Promise<unknown>) => void) | null {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  return rt?.waitUntil ? rt.waitUntil.bind(rt) : null;
}

async function runStyleFanOut(
  admin: ReturnType<typeof createClient>,
  generationId: string,
  referenceUrls: string[],
  resolvedPrompt: string,
  falKey: string,
): Promise<void> {
  try {
    const sortOrders = [0, 1, 2, 3];
    const tasks = sortOrders.map(sortOrder =>
      (async () => {
        const result = await callFalImage(GPT_IMAGE_SLUG, resolvedPrompt, referenceUrls, falKey);
        const update = result.url
          ? { status: 'done', image_url: result.url, error: null }
          : { status: 'failed', image_url: null, error: result.error };
        await admin
          .from('style_generation_images')
          .update(update)
          .eq('generation_id', generationId)
          .eq('sort_order', sortOrder);
        return update.status;
      })(),
    );
    const settled = await Promise.allSettled(tasks);
    const successes = settled.filter(s => s.status === 'fulfilled' && s.value === 'done').length;
    await admin.from('style_generations').update({
      status: successes > 0 ? 'done' : 'failed',
      error: successes > 0 ? null : 'all_providers_failed',
      completed_at: new Date().toISOString(),
    }).eq('id', generationId);
  } catch (err) {
    // A throw in the background must still close out the row, otherwise the
    // client polls a 'generating' row forever.
    await admin.from('style_generations').update({
      status: 'failed',
      error: `fanout_crash:${String(err).slice(0, 200)}`,
      completed_at: new Date().toISOString(),
    }).eq('id', generationId);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonRes({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const falKey = Deno.env.get('FAL_KEY');
  if (!supabaseUrl || !serviceKey || !anonKey) return jsonRes({ error: 'server_misconfigured' }, 500);
  if (!falKey) return jsonRes({ error: 'fal_key_missing' }, 500);

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
  if (!jwt) return jsonRes({ error: 'unauthorized' }, 401);

  // Verify the caller via the anon-key client + their JWT.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userResult, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userResult?.user) return jsonRes({ error: 'unauthorized' }, 401);
  const userId = userResult.user.id;

  let body: { generation_id?: string };
  try { body = await req.json() as typeof body; } catch { return jsonRes({ error: 'invalid_json' }, 400); }
  const generationId = body.generation_id;
  if (!generationId) return jsonRes({ error: 'missing_generation_id' }, 400);

  const admin = createClient(supabaseUrl, serviceKey);

  // Load the generation row and confirm ownership.
  const { data: genRow, error: genErr } = await admin
    .from('style_generations')
    .select('id, user_id, status, occasion, reference_urls')
    .eq('id', generationId)
    .single();
  if (genErr || !genRow) return jsonRes({ error: 'generation_not_found' }, 404);
  const generation = genRow as GenerationRow;
  if (generation.user_id !== userId) return jsonRes({ error: 'forbidden' }, 403);

  // Idempotent: if we already finished — or a background fan-out is already
  // running for this row — return the existing rows instead of starting a
  // second fan-out. The client polls these rows directly afterward.
  if (generation.status === 'done' || generation.status === 'failed' || generation.status === 'generating') {
    const { data: imgs } = await admin
      .from('style_generation_images')
      .select('*')
      .eq('generation_id', generation.id)
      .order('sort_order');
    return jsonRes({ generation, images: imgs ?? [] });
  }

  if (!Array.isArray(generation.reference_urls) || generation.reference_urls.length === 0) {
    await admin.from('style_generations').update({
      status: 'failed', error: 'no_reference_photos', completed_at: new Date().toISOString(),
    }).eq('id', generation.id);
    return jsonRes({ error: 'no_reference_photos' }, 400);
  }

  // Load profile context (gender, name, height_label, age_label) for prompt substitution.
  const { data: profile } = await admin
    .from('profiles')
    .select('gender, full_name, height_label, age_label')
    .eq('id', userId)
    .maybeSingle();
  const profileCtx: ProfileContext = {
    gender: ((profile?.gender as string) === 'male' || (profile?.gender as string) === 'female')
      ? (profile!.gender as 'male' | 'female') : 'unknown',
    full_name: (profile?.full_name as string | null) ?? null,
    height_label: (profile?.height_label as string | null) ?? null,
    age_label: (profile?.age_label as string | null) ?? null,
  };

  // Load the foundational prompt from app_settings.
  const { data: settingRow } = await admin
    .from('app_settings').select('value').eq('key', 'style_prompt').maybeSingle();
  const template = (settingRow?.value as string | null) ??
    "Make a style reference sheet for this {{gender}}, {{name}}, height {{height}} {{age}} years old, show amazing outfits {{pronoun}} can wear on {{occasion}}, but {{pronoun}}'s not trying too hard. Photo realistic. Don't show text";
  const resolvedPrompt = resolvePrompt(template, profileCtx, generation.occasion);

  // Snapshot context onto the row + flip status to 'generating' before fan-out.
  await admin.from('style_generations').update({
    status: 'generating',
    gender: profileCtx.gender,
    name: profileCtx.full_name,
    height_label: profileCtx.height_label,
    age_label: profileCtx.age_label,
    resolved_prompt: resolvedPrompt,
  }).eq('id', generation.id);

  // Seed 4 image rows in 'pending' so the client can poll/render placeholders.
  // All 4 use gpt-image-2 (nano-banana-2 dropped per request). `.select()` so
  // we can hand the seeded rows (with ids) straight back to the client.
  const seedRows = [
    { generation_id: generation.id, provider: 'gpt-image-2', sort_order: 0, status: 'pending' },
    { generation_id: generation.id, provider: 'gpt-image-2', sort_order: 1, status: 'pending' },
    { generation_id: generation.id, provider: 'gpt-image-2', sort_order: 2, status: 'pending' },
    { generation_id: generation.id, provider: 'gpt-image-2', sort_order: 3, status: 'pending' },
  ];
  await admin.from('style_generation_images').upsert(seedRows, { onConflict: 'generation_id,sort_order' });

  // Kick the slow fal.ai fan-out into a background task and respond NOW. The
  // worker stays alive for the waitUntil promise; the client polls the seeded
  // rows and fills tiles as each image lands. (Fallback: if EdgeRuntime isn't
  // present we detach the promise — still better than blocking the response.)
  const fanOut = runStyleFanOut(admin, generation.id, generation.reference_urls, resolvedPrompt, falKey);
  const waitUntil = getEdgeWaitUntil();
  if (waitUntil) waitUntil(fanOut); else void fanOut;

  // Return the 'generating' row + the 4 seeded pending rows immediately.
  const { data: genNow } = await admin
    .from('style_generations').select('*').eq('id', generation.id).single();
  const { data: seededImages } = await admin
    .from('style_generation_images').select('*').eq('generation_id', generation.id).order('sort_order');

  return jsonRes({ generation: genNow, images: seededImages ?? [] });
});
