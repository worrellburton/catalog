// Edge function — generate-style
//
// POST { generation_id } with the shopper's JWT in the Authorization header.
// 1. Verifies the JWT and that the generation row belongs to the caller.
// 2. Loads profile context (gender, name, height_label, age_label).
// 3. Reads the foundational prompt from app_settings('style_prompt') and
//    substitutes {{gender}} {{name}} {{height}} {{age}} {{pronoun}} {{occasion}}
//    plus the contracted form {{pronoun}}'s → he's|she's|they're.
// 4. Submits 4 fal.ai jobs in parallel — 2 to fal-ai/gpt-image-2/image-to-image,
//    2 to fal-ai/nano-banana-2/edit — each with the user's reference photos.
//    Both providers are asked for 16:9 outputs so the tile grid is consistent.
// 5. As each completes, writes a row into style_generation_images. When all
//    4 settle, marks the parent style_generations row done|failed.
// 6. Returns the parent row + the 4 image rows (success-only) to the client.
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
// gpt-image-2 exposes the edit endpoint at /image-to-image (verified
// against fal.ai docs — earlier guesses at /edit-image returned 404).
const GPT_IMAGE_SLUG = 'fal-ai/gpt-image-2/image-to-image';
const NANO_BANANA_SLUG = 'fal-ai/nano-banana-2/edit';

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
  return template
    .replace(/\{\{\s*gender\s*\}\}/g, genderWord(profile.gender))
    .replace(/\{\{\s*name\s*\}\}/g, name)
    .replace(/\{\{\s*height\s*\}\}/g, height)
    .replace(/\{\{\s*age\s*\}\}/g, age)
    .replace(/\{\{\s*pronoun\s*\}\}'s/g, pronounContraction(profile.gender))
    .replace(/\{\{\s*pronoun\s*\}\}/g, pronounSubject(profile.gender))
    .replace(/\{\{\s*occasion\s*\}\}/g, occasion.trim() || 'any occasion');
}

// ── fal.ai sync image generation ──────────────────────────────────────────

interface FalImageResult { url: string | null; error: string | null }

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
  // Per-provider 16:9 hint. gpt-image-2 takes a fixed image_size pair
  // (1536x1024 is the closest landscape preset to 16:9). nano-banana-2
  // accepts a free-form aspect_ratio. CSS still object-fit:cover so a
  // provider that ignores the hint still slots cleanly into the grid.
  if (modelSlug.includes('gpt-image-2')) {
    body.image_size = '1536x1024';
  } else if (modelSlug.includes('nano-banana-2')) {
    body.aspect_ratio = '16:9';
  }
  let res: Response;
  try {
    res = await fetch(`${FAL_BASE_SYNC}/${modelSlug}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${falKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { url: null, error: `network_error:${String(err).slice(0, 200)}` };
  }
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

  // Idempotent: if we already finished, return the existing rows.
  if (generation.status === 'done' || generation.status === 'failed') {
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
  // Sort order: 0,1 = gpt-image-2; 2,3 = nano-banana-2.
  const seedRows = [
    { generation_id: generation.id, provider: 'gpt-image-2', sort_order: 0, status: 'pending' },
    { generation_id: generation.id, provider: 'gpt-image-2', sort_order: 1, status: 'pending' },
    { generation_id: generation.id, provider: 'nano-banana-2', sort_order: 2, status: 'pending' },
    { generation_id: generation.id, provider: 'nano-banana-2', sort_order: 3, status: 'pending' },
  ];
  await admin.from('style_generation_images').upsert(seedRows, { onConflict: 'generation_id,sort_order' });

  // Fan out 4 fal.ai calls in parallel. Each result is written immediately so
  // a partial success still surfaces images even if one provider 500s.
  const tasks = seedRows.map(seed =>
    (async () => {
      const slug = seed.provider === 'gpt-image-2' ? GPT_IMAGE_SLUG : NANO_BANANA_SLUG;
      const result = await callFalImage(slug, resolvedPrompt, generation.reference_urls, falKey);
      const update = result.url
        ? { status: 'done', image_url: result.url, error: null }
        : { status: 'failed', image_url: null, error: result.error };
      await admin
        .from('style_generation_images')
        .update(update)
        .eq('generation_id', generation.id)
        .eq('sort_order', seed.sort_order);
      return { sort_order: seed.sort_order, ...update };
    })(),
  );
  const settled = await Promise.allSettled(tasks);

  // Mark the parent generation done if we got at least one image; otherwise failed.
  const successes = settled.filter(s => s.status === 'fulfilled' && (s.value as { status: string }).status === 'done').length;
  const finalStatus = successes > 0 ? 'done' : 'failed';
  const failureReason = successes > 0 ? null : 'all_providers_failed';
  await admin.from('style_generations').update({
    status: finalStatus,
    error: failureReason,
    completed_at: new Date().toISOString(),
  }).eq('id', generation.id);

  // Return the final row + image rows so the client can render immediately.
  const { data: finalRow } = await admin
    .from('style_generations').select('*').eq('id', generation.id).single();
  const { data: finalImages } = await admin
    .from('style_generation_images').select('*').eq('generation_id', generation.id).order('sort_order');

  return jsonRes({ generation: finalRow, images: finalImages ?? [] });
});
