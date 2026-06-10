// polish-primary-image
//
// Reframes a product's existing primary image into a standardized 3:4
// (portrait) e-commerce packshot using Google's Gemini 2.5 Flash Image
// model ("nano-banana") via the Gemini API directly (not fal.ai).
// Preserves the source background and product appearance — only adds
// padding so every primary image in the catalog grid lines up.
//
// Source-URL choice on re-polish: always start from the pre-polish URL
// when one exists. Otherwise re-polishing the already-polished image
// compounds zoom-on-zoom — each subsequent run reads a polished input
// as "the product" and crops in further.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

const GEMINI_MODEL = 'gemini-2.5-flash-image';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = 60_000;
const POLISH_BUCKET = 'scraped-products';

const POLISH_PROMPT_KEY = 'prompt_polish_primary';
// "Add padding" framing is much stricter than "occupies 60%" — Gemini
// was reading the latter as "make the product bigger" and producing
// zoomed crops. Explicit DO NOT ZOOM language fixes this.
const DEFAULT_POLISH_PROMPT = [
  'Take the supplied product image and convert it to a 3:4 portrait aspect ratio.',
  'DO NOT zoom in. DO NOT crop the product or change its size. The product must appear at the SAME SCALE as in the source image — never larger.',
  'Add neutral padding (extend the existing background) above, below, and on the sides as needed to reach a 3:4 canvas.',
  'The product should occupy about 60–70% of the canvas HEIGHT, with clear empty space (background) above and below it. Generous breathing room.',
  "Keep the product's existing background exactly as-is — do not remove, replace, or recolor it. Extend it naturally into the new padding area.",
  "Preserve the product's original colors, texture, lighting, proportions, and every detail exactly. Do not restyle the product.",
  'Output a crisp packshot with comfortable margin around the product.',
].join(' ');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface GeminiPart { text?: string; inline_data?: { mime_type?: string; data?: string }; inlineData?: { mimeType?: string; data?: string } }

async function callGeminiNanoBanana(prompt: string, sourceUrl: string, apiKey: string): Promise<{ data: string | null; mime: string; error: string | null }> {
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

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: prompt },
          { inline_data: { mime_type: srcMime, data: bytesToBase64(srcBytes) } },
        ] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: '3:4' },
        },
      }),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as { name?: string })?.name === 'AbortError') return { data: null, mime: '', error: `timeout_${GEMINI_TIMEOUT_MS}ms` };
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
  try { body = await req.json(); } catch { return json({ success: false, error: 'JSON body required' }); }
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

  // Polish FROM the original raw image when one is on file AND the
  // current primary is still the polished output of that original.
  // If the admin has since *replaced* the primary (e.g. uploaded a new
  // photo + starred it), primary_image_polished flips to false and we
  // must polish the new primary directly — not silently re-polish the
  // stale pre-polish anchor (the previous bug: a hand-picked primary
  // got overwritten back to the old multi-pack image on re-polish).
  const useAnchor = !!product.primary_image_pre_polish_url
    && product.primary_image_polished === true;
  const sourceUrl    = useAnchor ? product.primary_image_pre_polish_url! : product.primary_image_url;
  const prePolishUrl = useAnchor ? product.primary_image_pre_polish_url! : product.primary_image_url;

  let polishPrompt = DEFAULT_POLISH_PROMPT;
  try {
    const { data: setting } = await admin
      .from('app_settings').select('value').eq('key', POLISH_PROMPT_KEY).maybeSingle();
    const v = (setting?.value as string | null)?.trim();
    if (v) polishPrompt = v;
  } catch { /* keep default */ }

  const t0 = Date.now();
  const result = await callGeminiNanoBanana(polishPrompt, sourceUrl, googleKey);
  const durationMs = Date.now() - t0;
  if (!result.data) return json({ success: false, error: result.error || 'polish failed' });

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
    primary_image_polish_duration_ms: durationMs,
  }).eq('id', productId);
  if (updateErr) return json({ success: false, error: updateErr.message });

  return json({ success: true, polished_url: polishedUrl, pre_polish_url: prePolishUrl, duration_ms: durationMs });
});
