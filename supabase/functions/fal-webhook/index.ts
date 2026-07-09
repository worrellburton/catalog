// Edge function — fal-webhook
//
// Fal posts here when a queued request finishes (we wired the webhook
// query param in generate-look). Body shape:
//   { request_id, gateway_request_id, status: 'OK' | 'ERROR' | ..., payload: {...} }
// For video models the payload looks like { video: { url } } or
// { videos: [{ url }] }. We look up user_generations by fal_request_id
// and write status + video_url back regardless of RLS (service role).
//
// Deployed with verify_jwt=false: Fal does not present a Supabase JWT
// when calling. Authenticity check is "row matches request_id" plus
// status='generating' so a stray POST can't promote a finished row.
//
// Environment:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface FalCallback {
  request_id?: string;
  gateway_request_id?: string;
  status?: string;
  payload?: {
    video?: { url?: string };
    videos?: Array<{ url?: string }>;
    error?: string;
    detail?: unknown;
  };
  error?: string;
  detail?: unknown;
}

// Pull the most informative human-readable error out of Fal's
// callback. Fal sometimes nests the upstream model's error under
// `payload.error` or `payload.detail`, sometimes flat at top-level.
// Without digging into both we'd surface useless strings like
// "Unexpected status code: 422" with zero context.
function extractError(body: FalCallback): string {
  const parts: string[] = [];
  if (body.error) parts.push(body.error);
  if (body.payload?.error && body.payload.error !== body.error) parts.push(body.payload.error);
  if (body.payload?.detail) {
    try { parts.push(typeof body.payload.detail === 'string' ? body.payload.detail : JSON.stringify(body.payload.detail)); }
    catch { /* ignore */ }
  }
  if (body.detail) {
    try { parts.push(typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)); }
    catch { /* ignore */ }
  }
  if (parts.length === 0) parts.push(`Fal status: ${body.status || 'unknown'}`);
  return parts.join(' — ').slice(0, 800);
}

// Map raw Fal/ByteDance error strings to a structured (error_code,
// user-facing message) pair. The error_code is what the UI keys off
// of to render an actionable hint instead of a wall of JSON.
function classifyError(raw: string): { code: string; message: string } {
  const r = raw.toLowerCase();
  if (r.includes('partner_validation_failed') || r.includes('content_policy') || r.includes('moderation')) {
    return {
      code: 'content_policy',
      message: 'The video provider blocked this look. The most common reason is a recognisable celebrity or public figure in the photo — try a different selfie. Other triggers: minors, brand logos prominently in frame, or NSFW content.',
    };
  }
  if (r.includes('face') && (r.includes('not detected') || r.includes('no face'))) {
    return { code: 'no_face_detected', message: 'No face detected in the reference photo. Try a clearer, front-facing selfie.' };
  }
  if (r.includes('image') && (r.includes('invalid') || r.includes('unsupported') || r.includes('format'))) {
    return { code: 'invalid_image', message: 'One of the reference photos couldn\u2019t be read by the video provider. Try re-uploading a JPEG.' };
  }
  if (r.includes('timeout') || r.includes('timed out')) {
    return { code: 'timeout', message: 'The video provider timed out. Please try again.' };
  }
  if (r.includes('rate') && r.includes('limit')) {
    return { code: 'rate_limit', message: 'The video provider is rate-limited. Please try again in a minute.' };
  }
  return { code: 'fal_error', message: 'Generation failed. Please try again or pick different photos / products.' };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonRes({ error: 'Use POST' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return jsonRes({ error: 'Supabase env missing' }, 500);

  let body: FalCallback;
  try { body = await req.json() as FalCallback; }
  catch { return jsonRes({ error: 'Invalid JSON' }, 400); }

  const requestId = body.request_id || body.gateway_request_id;
  if (!requestId) return jsonRes({ error: 'request_id missing' }, 400);

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: gen, error: lookupErr } = await admin
    .from('user_generations')
    .select('id, status, veo_model')
    .eq('fal_request_id', requestId)
    .maybeSingle();

  if (lookupErr) return jsonRes({ error: lookupErr.message }, 500);
  if (!gen) {
    // Not a user_generation row — try products.primary_video_request_id
    // (async primary-video pipeline: generate-primary-video submits to
    // queue.fal.run, fal posts back here when the clip is ready).
    const { data: productRow } = await admin
      .from('products')
      .select('id, primary_video_status, primary_video_source_image_url')
      .eq('primary_video_request_id', requestId)
      .maybeSingle();
    if (!productRow) {
      // Neither table claims this request_id — 200 to stop Fal retries.
      return jsonRes({ acknowledged: true, matched: false });
    }
    if (productRow.primary_video_status === 'done' || productRow.primary_video_status === 'failed') {
      return jsonRes({ acknowledged: true, already: productRow.primary_video_status });
    }
    const okP = body.status === 'OK';
    const videoUrlP = body.payload?.video?.url || body.payload?.videos?.[0]?.url || null;
    let prodUpdate: Record<string, unknown>;
    if (okP && videoUrlP) {
      prodUpdate = {
        primary_video_url:           videoUrlP,
        primary_video_status:        'done',
        primary_video_generated_at:  new Date().toISOString(),
        // Re-affirm the source so a UI-side viewer knows which image
        // animated; safe if it was already set.
        primary_video_source_image_url: productRow.primary_video_source_image_url,
      };
    } else {
      prodUpdate = {
        primary_video_status: 'failed',
      };
      try {
        console.error('[fal-webhook] primary-video failed request_id=', requestId, extractError(body));
      } catch { /* noop */ }
    }
    const { error: prodErr } = await admin.from('products').update(prodUpdate).eq('id', productRow.id);
    if (prodErr) return jsonRes({ error: prodErr.message }, 500);
    return jsonRes({ acknowledged: true, product_id: productRow.id, status: prodUpdate.primary_video_status });
  }

  // Idempotency: a Fal retry can land after we've already written the
  // result. Refuse to overwrite anything that's already terminal.
  if (gen.status === 'done' || gen.status === 'failed') {
    return jsonRes({ acknowledged: true, already: gen.status });
  }

  const ok = body.status === 'OK';
  const videoUrl = body.payload?.video?.url || body.payload?.videos?.[0]?.url || null;

  let update: Record<string, unknown>;
  if (ok && videoUrl) {
    // Store the model's clip URL as-is. (Gemini Omni renders carry a talking
    // audio track, but that's silenced at every player via the muted PROPERTY
    // and stripped from downloads — a server-side re-encode strip was removed:
    // Fal's ffmpeg-compose passed the audio through unchanged while degrading
    // the video, so it only cost latency + money.)
    update = { status: 'done', video_url: videoUrl, error: null, error_code: null, completed_at: new Date().toISOString() };
  } else {
    const rawError = extractError(body);
    const { code, message } = classifyError(rawError);

    // ── Content-policy fallback: Seedance → Gemini Omni ──────────────────────
    // Seedance's partner_validation filter blocks SOME real shopper faces (even
    // the shopper's own, consented via end_user_id) while accepting others —
    // it's selective, not all-or-nothing. Gemini Omni accepts every face. So on
    // a content_policy block of a SEEDANCE render, retry the SAME look on Gemini
    // instead of failing. Loop guard: only fall back FROM a Seedance render
    // (veo_model starts with 'bytedance/'); a Gemini render that still blocks
    // (rare) falls through to the normal 'failed' path below.
    const wasSeedance = typeof gen.veo_model === 'string' && gen.veo_model.startsWith('bytedance/');
    if (code === 'content_policy' && wasSeedance) {
      // Reset to 'pending' and drop the Seedance request_id so a Fal retry of
      // THIS callback can no longer match the row (prevents a double fallback).
      await admin.from('user_generations').update({
        status: 'pending', fal_request_id: null, error: null, error_code: null, error_raw: null,
      }).eq('id', gen.id);
      try {
        await admin.from('generation_events').insert({
          generation_id: gen.id, event: 'content_policy_fallback',
          payload: { from: gen.veo_model, to: 'google/gemini-omni-flash/reference-to-video', raw: rawError.slice(0, 300) },
        });
      } catch { /* noop */ }
      // Re-run generate-look for this gen, forcing the Gemini Omni model.
      try {
        await fetch(`${supabaseUrl}/functions/v1/generate-look`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ generation_id: gen.id, force_model: 'google/gemini-omni-flash/reference-to-video' }),
        });
      } catch (e) {
        console.error('[fal-webhook] gemini fallback invoke failed', e);
      }
      return jsonRes({ acknowledged: true, generation_id: gen.id, status: 'retrying_gemini' });
    }

    update = {
      status: 'failed',
      error: message,           // user-facing, friendly
      error_code: code,         // machine-readable
      error_raw: rawError,      // full Fal/ByteDance text for debugging
      completed_at: new Date().toISOString(),
    };
    // Print the entire Fal payload to logs once so we have something to grep.
    try {
      console.error('[fal-webhook] non-OK callback for request_id=', requestId, 'code=', code, JSON.stringify(body).slice(0, 1500));
    } catch { /* noop */ }
  }

  const { error: updateErr } = await admin
    .from('user_generations')
    .update(update)
    .eq('id', gen.id);

  if (updateErr) return jsonRes({ error: updateErr.message }, 500);

  // Record the raw Fal callback in generation_events so "Show details"
  // can surface a timeline instead of just a single error string.
  try {
    await admin.from('generation_events')
      .insert({
        generation_id: gen.id,
        event: 'fal_webhook',
        payload: {
          status: update.status,
          fal_status: body.status,
          request_id: requestId,
          video_url: update.video_url ?? null,
          error: update.error ?? null,
          error_code: update.error_code ?? null,
          error_raw: update.error_raw ?? null,
          fal_body: body,
        },
      });
  } catch (e) {
    console.warn('[fal-webhook] logEvent failed', e);
  }

  return jsonRes({ acknowledged: true, generation_id: gen.id, status: update.status });
});
