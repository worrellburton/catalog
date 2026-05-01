// check-face-photo — pre-validates reference images against
// Fal/ByteDance Seedance 2 before the user starts a real generation.
//
// POST { image_urls: string[]; user_id?: string }
// → 200 { ok, reason, detail }
//
// IMPORTANT IMPLEMENTATION NOTE:
//   ByteDance's `partner_validation_failed` error does NOT surface at
//   queue-submit time. Fal accepts the job (HTTP 200, IN_QUEUE), runs
//   it through ByteDance's safety filter, and reports the failure as a
//   COMPLETED job whose response body contains a `detail[]` error array
//   instead of a `video` field. The whole loop takes ~5–10 seconds.
//
//   Crucially, single-photo submissions almost always pass — the
//   "likeness of real people" filter fires only when ByteDance has
//   enough reference frames to be confident it's a real person (i.e.
//   2–3 photos). So the per-photo check is mostly useful for catching
//   NSFW / no-face / corrupt-image rejections; the combo check (all
//   photos together) is what catches partner_validation_failed.
//
// Reasons returned when ok=false:
//   partner_validation_failed  — ByteDance "real likeness" safety filter
//   content_policy_violation   — generic content policy
//   no_face_detected
//   blocked                    — any other Fal rejection
//   network_error              — couldn't reach Fal
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const FAL_BASE = 'https://queue.fal.run';
const MODEL = 'bytedance/seedance-2.0/fast/reference-to-video';
const MODEL_BASE = 'bytedance/seedance-2.0';
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 15000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

interface ParsedError { reason: string; detail: string; }

// Parse Fal's error envelope (used both for HTTP 4xx bodies and for
// COMPLETED jobs whose body contains `detail[]` instead of a video).
function parseFalError(parsed: unknown): ParsedError {
  let reason = 'blocked';
  let detail = '';
  try {
    const root = parsed as Record<string, unknown> | null;
    if (!root) return { reason, detail };
    const errs = (root.detail ?? (root.payload as Record<string, unknown> | undefined)?.detail) as unknown[] | undefined;
    const first = Array.isArray(errs) ? errs[0] as Record<string, unknown> : null;
    if (!first) return { reason, detail };
    const ctx = first.ctx as Record<string, unknown> | undefined;
    const extra = ctx?.extra_info as Record<string, unknown> | undefined;
    const extraReason = extra?.reason as string | undefined;
    if (extraReason === 'partner_validation_failed') reason = 'partner_validation_failed';
    else if (first.type === 'content_policy_violation') reason = 'content_policy_violation';
    else if (first.type === 'no_face_detected') reason = 'no_face_detected';
    if (typeof first.msg === 'string') detail = first.msg.slice(0, 300);
  } catch { /* keep defaults */ }
  return { reason, detail };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const falKey = Deno.env.get('FAL_KEY');
  if (!falKey) return json({ ok: false, reason: 'server_config', detail: 'FAL_KEY not configured' }, 500);

  // Read the configured video model from app_settings. If it's not a
  // ByteDance/Seedance model, the validation logic below is irrelevant
  // (Vidu doesn't have a "partner_validation_failed" filter), so we
  // skip the whole Fal round-trip and return ok immediately.
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (supabaseUrl && supabaseKey) {
      const settingsResp = await fetch(
        `${supabaseUrl}/rest/v1/app_settings?key=eq.look_video_model&select=value`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } },
      );
      if (settingsResp.ok) {
        const rows = await settingsResp.json() as Array<{ value: string }>;
        const model = rows[0]?.value ?? '';
        const isSeedance = model.includes('bytedance') || model.includes('seedance');
        if (!isSeedance) {
          return json({ ok: true, reason: null, detail: null });
        }
      }
    }
  } catch { /* fall through — if we can't read settings, run the check anyway */ }

  let body: { image_urls?: string[]; image_url?: string; user_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: 'bad_request', detail: 'Invalid JSON' }, 400);
  }

  // Accept either `image_urls` (multi) or legacy `image_url` (single).
  const urls: string[] = Array.isArray(body.image_urls)
    ? body.image_urls.filter((u): u is string => typeof u === 'string' && !!u)
    : (typeof body.image_url === 'string' ? [body.image_url] : []);
  if (!urls.length) return json({ ok: false, reason: 'missing_image_url', detail: null }, 400);

  const payload: Record<string, unknown> = {
    prompt: '@Image1',
    image_urls: urls,
    duration: '5',
    aspect_ratio: '9:16',
    generate_audio: false,
  };
  if (body.user_id) payload.end_user_id = body.user_id;

  // 1. Submit
  let submitResp: Response;
  try {
    submitResp = await fetch(`${FAL_BASE}/${MODEL}`, {
      method: 'POST',
      headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[check-face-photo] network error:', err);
    return json({ ok: false, reason: 'network_error', detail: String(err) });
  }

  const submitText = await submitResp.text();
  console.log('[check-face-photo] submit status:', submitResp.status);

  if (!submitResp.ok) {
    let parsed: unknown = null;
    try { parsed = JSON.parse(submitText); } catch { /* keep null */ }
    const { reason, detail } = parseFalError(parsed);
    return json({ ok: false, reason, detail: detail || submitText.slice(0, 300) });
  }

  let requestId: string | undefined;
  try {
    requestId = (JSON.parse(submitText) as { request_id?: string }).request_id;
  } catch { /* ignore */ }
  if (!requestId) return json({ ok: true, reason: null, detail: null });

  // 2. Poll for completion. ByteDance safety rejection arrives as a
  //    COMPLETED status whose result body contains `detail` (errors)
  //    instead of `video`. Successful jobs take 30–90s; failures
  //    surface within ~5–10s — we cap polling at 15s and cancel
  //    anything still pending so we don't burn a full inference run.
  const start = Date.now();
  let finalStatus = 'IN_QUEUE';
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    let statusResp: Response;
    try {
      statusResp = await fetch(`${FAL_BASE}/${MODEL_BASE}/requests/${requestId}/status`, {
        headers: { Authorization: `Key ${falKey}` },
      });
    } catch (err) {
      console.warn('[check-face-photo] status poll failed:', err);
      continue;
    }
    if (!statusResp.ok) continue;
    const statusBody = await statusResp.json().catch(() => ({}));
    finalStatus = (statusBody as { status?: string }).status ?? 'IN_QUEUE';
    console.log(`[check-face-photo] poll t=${Date.now() - start}ms status=${finalStatus}`);
    if (finalStatus === 'COMPLETED' || finalStatus === 'FAILED' || finalStatus === 'ERROR') break;
  }

  // 3. If still running after timeout, cancel (best-effort) and assume ok.
  if (finalStatus !== 'COMPLETED' && finalStatus !== 'FAILED' && finalStatus !== 'ERROR') {
    fetch(`${FAL_BASE}/${MODEL_BASE}/requests/${requestId}/cancel`, {
      method: 'PUT',
      headers: { Authorization: `Key ${falKey}` },
    }).catch((err) => console.warn('[check-face-photo] cancel failed:', err));
    return json({ ok: true, reason: null, detail: 'timeout' });
  }

  // 4. Fetch final result. COMPLETED jobs may contain either a video
  //    (success) or detail[] (rejection).
  let resultResp: Response;
  try {
    resultResp = await fetch(`${FAL_BASE}/${MODEL_BASE}/requests/${requestId}`, {
      headers: { Authorization: `Key ${falKey}` },
    });
  } catch (err) {
    console.error('[check-face-photo] result fetch failed:', err);
    return json({ ok: true, reason: null, detail: 'result_fetch_failed' });
  }

  const resultBody = await resultResp.json().catch(() => ({}));
  const r = resultBody as Record<string, unknown>;
  if (r.video) return json({ ok: true, reason: null, detail: null });
  if (r.detail) {
    const { reason, detail } = parseFalError(r);
    return json({ ok: false, reason, detail });
  }
  if (finalStatus === 'FAILED' || finalStatus === 'ERROR') {
    return json({ ok: false, reason: 'blocked', detail: JSON.stringify(r).slice(0, 300) });
  }
  return json({ ok: true, reason: null, detail: null });
});
