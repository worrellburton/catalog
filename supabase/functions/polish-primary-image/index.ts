// polish-primary-image
//
// Reframes a product's existing primary image into a standardized 4:5
// (portrait) e-commerce packshot using Google's Gemini 2.5 Flash Image model
// ("nano-banana") via the Gemini API directly (not fal.ai). Preserves
// the source background and product appearance — only adds uniform
// padding so every primary image in the catalog grid lines up.
//
// Gemini returns the edited image as base64, so we decode it and upload
// to the public `scraped-products` storage bucket, then store that URL
// on the product.
//
// POST { product_id: string }
// → 200 { success: true, polished_url, pre_polish_url }
//   or { success: false, error }
//
// Auth: admin JWT or service-role JWT (role claim decoded out of the
// JWT payload so a service-role call from a trigger can't be denied by
// a byte-equality mismatch against the function's env var).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

// Gemini 2.5 Flash Image (nano-banana), called directly on the Gemini API.
const GEMINI_MODEL = 'gemini-2.5-flash-image';
// NB: image output + responseModalities live on the v1beta surface; the
// stable v1 endpoint rejects responseModalities with a 400.
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = 60_000;
const POLISH_BUCKET = 'scraped-products';

// Polish prompt — admin-editable via the Data → Settings modal, stored
// in app_settings under POLISH_PROMPT_KEY. This inline string is the
// fallback used when no row exists yet. Keep in sync with
// app/constants/ai-prompts.ts (DEFAULT_POLISH_PRIMARY_PROMPT).
const POLISH_PROMPT_KEY = 'prompt_polish_primary';
const DEFAULT_POLISH_PROMPT = [
  "Reframe this product image into a standardized e-commerce shot with a 4:5 aspect ratio (portrait, e.g. 1600x2000px).",
  "Keep the product's existing background exactly as-is — do not remove, replace, or alter it.",
  "Center the product both horizontally and vertically so it occupies approximately 60% of the frame, with equal padding (~15% of the canvas) on all four sides, extending the existing background naturally to fill any added space.",
  "Preserve the product's original colors, texture, lighting, proportions, and details exactly — do not alter, recolor, or restyle the product itself.",
  "Output a crisp image suitable for a uniform product catalog grid.",
].join(' ');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// Base64 helpers — chunked so large images don't blow the call stack.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface GeminiPart { text?: string; inline_data?: { mime_type?: string; data?: string }; inlineData?: { mimeType?: string; data?: string } }

// Call Gemini with the source image + prompt; returns the edited image
// as { data: base64, mime }. Reads the source from its URL first.
async function callGeminiNanoBanana(
  prompt: string,
  sourceUrl: string,
  apiKey: string,
): Promise<{ data: string | null; mime: string; error: string | null }> {
  // 1. Pull the source image bytes + mime.
  let srcBytes: Uint8Array;
  let srcMime = 'image/jpeg';
  try {
    const imgRes = await fetch(sourceUrl);
    if (!imgRes.ok) return { data: null, mime: '', error: `source_fetch_${imgRes.status}` };
    srcMime = imgRes.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
    srcBytes = new Uint8Array(await imgRes.arrayBuffer());
  } catch (err) {
    return { data: null, mime: '', error: `source_fetch_error:${String(err).slice(0, 160)}` };
  }

  // 2. Ask Gemini to reframe it.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: srcMime, data: bytesToBase64(srcBytes) } },
          ],
        }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as { name?: string })?.name === 'AbortError') {
      return { data: null, mime: '', error: `timeout_${GEMINI_TIMEOUT_MS}ms` };
    }
    return { data: null, mime: '', error: `network_error:${String(err).slice(0, 160)}` };
  }
  clearTimeout(timer);

  const text = await res.text().catch(() => '');
  if (!res.ok) return { data: null, mime: '', error: `gemini_${res.status}:${text.slice(0, 300)}` };

  let parsed: { candidates?: Array<{ content?: { parts?: GeminiPart[] } }> };
  try { parsed = JSON.parse(text); } catch { return { data: null, mime: '', error: 'gemini_bad_json' }; }
  const parts = parsed.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    const inl = p.inline_data ?? p.inlineData;
    const data = inl?.data;
    if (data) {
      const mime = (p.inline_data?.mime_type ?? p.inlineData?.mimeType) || 'image/png';
      return { data, mime, error: null };
    }
  }
  return { data: null, mime: '', error: 'gemini_no_image' };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ success: false, error: 'POST only' }, 405);

  const supabaseUrl    = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const googleKey      = Deno.env.get('GOOGLE_API_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return json({ success: false, error: 'edge function misconfigured' });
  if (!googleKey) return json({ success: false, error: 'GOOGLE_API_KEY not configured' });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ success: false, error: 'unauthorized' }, 401);
  const token = authHeader.replace('Bearer ', '');
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // Decode the JWT role claim to allow service-role callers (triggers)
  // to bypass the admin gate. Byte-equality against the env var fails
  // when the vault holds a different (still valid) service-role JWT.
  let isServiceRole = false;
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload?.role === 'service_role') isServiceRole = true;
    }
  } catch { /* fall through to user-JWT path */ }
  if (!isServiceRole) {
    const { data: { user: caller } } = await admin.auth.getUser(token);
    if (!caller) return json({ success: false, error: 'unauthorized' }, 401);
    const { data: prof } = await admin.from('profiles').select('is_admin, role').eq('id', caller.id).maybeSingle();
    const isAdmin = prof?.is_admin === true || prof?.role === 'admin' || prof?.role === 'super_admin';
    if (!isAdmin) return json({ success: false, error: 'admin only' }, 403);
  }

  let body: { product_id?: string };
  try { body = await req.json(); }
  catch { return json({ success: false, error: 'JSON body required' }); }

  const productId = body.product_id;
  if (!productId) return json({ success: false, error: 'product_id required' });

  const { data: product, error: loadErr } = await admin
    .from('products')
    .select('id, primary_image_url, primary_image_polished, primary_image_pre_polish_url')
    .eq('id', productId)
    .maybeSingle();
  if (loadErr) return json({ success: false, error: loadErr.message });
  if (!product) return json({ success: false, error: 'product not found' }, 404);
  if (!product.primary_image_url) return json({ success: false, error: 'product has no primary_image_url to polish' });

  // The current primary URL becomes the "source" for the polish call.
  // If a prior pre-polish URL is stored, keep that — the original
  // pre-polish source is preserved across multiple polish runs.
  const sourceUrl    = product.primary_image_url;
  const prePolishUrl = product.primary_image_pre_polish_url ?? sourceUrl;

  // Admin-editable prompt override (Data → Settings). Falls back to the
  // inline default when the app_settings row is missing or blank.
  let polishPrompt = DEFAULT_POLISH_PROMPT;
  try {
    const { data: setting } = await admin
      .from('app_settings').select('value').eq('key', POLISH_PROMPT_KEY).maybeSingle();
    const v = (setting?.value as string | null)?.trim();
    if (v) polishPrompt = v;
  } catch { /* keep default */ }

  const result = await callGeminiNanoBanana(polishPrompt, sourceUrl, googleKey);
  if (!result.data) return json({ success: false, error: result.error || 'polish failed' });

  // Gemini hands back base64 — decode + upload to public storage.
  const ext = result.mime.includes('png') ? 'png' : result.mime.includes('webp') ? 'webp' : 'jpg';
  const path = `polished/${productId}-${Date.now()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from(POLISH_BUCKET)
    .upload(path, base64ToBytes(result.data), { contentType: result.mime, upsert: true });
  if (upErr) return json({ success: false, error: `storage_upload:${upErr.message}` });
  const { data: pub } = admin.storage.from(POLISH_BUCKET).getPublicUrl(path);
  const polishedUrl = pub.publicUrl;
  if (!polishedUrl) return json({ success: false, error: 'storage_public_url_failed' });

  const { error: updateErr } = await admin.from('products').update({
    primary_image_url:           polishedUrl,
    primary_image_polished:      true,
    primary_image_polished_at:   new Date().toISOString(),
    primary_image_pre_polish_url: prePolishUrl,
  }).eq('id', productId);
  if (updateErr) return json({ success: false, error: updateErr.message });

  return json({
    success: true,
    polished_url: polishedUrl,
    pre_polish_url: prePolishUrl,
  });
});
