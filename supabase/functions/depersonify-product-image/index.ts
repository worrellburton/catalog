// depersonify-product-image
//
// For an apparel product whose only images are ON-MODEL (a human wearing it),
// Seedance's try-on blocks the render (non-consented human likeness). This
// function uses Gemini 2.5 Flash Image ("nano-banana", same infra as
// polish-primary-image) to extract JUST the garment into a clean person-free
// packshot, uploads it, and PREPENDS it to images_raw. It then does NOT pick
// the primary itself — the caller re-runs verify-product-image, whose vision
// pass confirms the new image is person-free ('good' + person:false) and
// promotes it to primary + sets primary_image_person_free=true. Reusing verify
// as the gate means a bad de-person (person still present / distorted) simply
// isn't promoted, and the product stays text-described.
//
// POST { product_id: string, force?: boolean }
//   force = de-person even if primary is already person-free (default: skip).

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
const BUCKET = 'scraped-products';
const PROMPT_KEY = 'prompt_depersonify_primary';

// Garment extraction — remove the model entirely, keep the product exactly.
function buildPrompt(desc: string): string {
  return [
    `Extract ONLY the clothing product from this photo and present it as a clean e-commerce packshot. The product is: "${desc}".`,
    'Completely REMOVE the human model — no person, face, head, hands, skin, hair, legs, feet, or any body part may remain anywhere in the frame.',
    'Show the garment by itself as if laid flat or worn on an invisible ghost mannequin, against a plain, softly and evenly lit neutral light-grey studio background.',
    "Preserve the garment EXACTLY: identical color, shade, pattern, fabric texture, seams, buttons, print, cut and proportions. Do NOT restyle, recolor, or add any text, logos, or graphics that were not already on the garment.",
    'Center the product with comfortable margin. Output a crisp, photorealistic product packshot.',
  ].join(' ');
}

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

async function callGemini(prompt: string, sourceUrl: string, apiKey: string): Promise<{ data: string | null; mime: string; error: string | null }> {
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

  // Auth: service-role JWT (pg_net trigger) OR admin user JWT — same as polish/verify.
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
  } catch { /* fall through */ }
  if (!isServiceRole) {
    const { data: { user: caller } } = await admin.auth.getUser(token);
    if (!caller) return json({ success: false, error: 'unauthorized' }, 401);
    const { data: prof } = await admin.from('profiles').select('is_admin, role').eq('id', caller.id).maybeSingle();
    const isAdmin = prof?.is_admin === true || prof?.role === 'admin' || prof?.role === 'super_admin';
    if (!isAdmin) return json({ success: false, error: 'admin only' }, 403);
  }

  let body: { product_id?: string; force?: boolean };
  try { body = await req.json(); } catch { return json({ success: false, error: 'JSON body required' }); }
  const productId = body.product_id;
  if (!productId) return json({ success: false, error: 'product_id required' });

  const { data: product, error: loadErr } = await admin
    .from('products')
    .select('id, brand, name, type, image_url, primary_image_url, images_raw, primary_image_person_free')
    .eq('id', productId)
    .maybeSingle();
  if (loadErr) return json({ success: false, error: loadErr.message });
  if (!product) return json({ success: false, error: 'product not found' }, 404);
  if (product.primary_image_person_free === true && body.force !== true) {
    return json({ success: true, skipped: 'already_person_free' });
  }
  const source = (typeof product.primary_image_url === 'string' && product.primary_image_url)
    || (typeof product.image_url === 'string' && product.image_url) || null;
  if (!source) return json({ success: false, error: 'no source image' });

  let prompt = buildPrompt([product.brand, product.name, product.type].filter(Boolean).join(' — ') || 'this clothing product');
  try {
    const { data: setting } = await admin.from('app_settings').select('value').eq('key', PROMPT_KEY).maybeSingle();
    const v = (setting?.value as string | null)?.trim();
    if (v) prompt = v; // operator override (plain text)
  } catch { /* keep default */ }

  const t0 = Date.now();
  const result = await callGemini(prompt, source, googleKey);
  if (!result.data) return json({ success: false, error: result.error || 'depersonify failed' });

  const ext = result.mime.includes('png') ? 'png' : result.mime.includes('webp') ? 'webp' : 'jpg';
  const path = `depersonified/${productId}-${Date.now()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from(BUCKET).upload(path, base64ToBytes(result.data), { contentType: result.mime, upsert: true });
  if (upErr) return json({ success: false, error: `storage_upload:${upErr.message}` });
  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  const newUrl = pub?.publicUrl;
  if (!newUrl) return json({ success: false, error: 'storage_public_url_failed' });

  // Prepend to images_raw so the next verify run considers it FIRST. verify's
  // vision pass is the gate: it confirms person-free + promotes to primary.
  const rawArr: string[] = Array.isArray(product.images_raw)
    ? (product.images_raw as unknown[]).filter((u): u is string => typeof u === 'string' && u.length > 0)
    : [];
  const nextRaw = [newUrl, ...rawArr.filter(u => u !== newUrl)];
  const { error: updErr } = await admin.from('products')
    .update({ images_raw: nextRaw }).eq('id', productId);
  if (updErr) return json({ success: false, error: `update: ${updErr.message}` });

  return json({ success: true, depersonified_url: newUrl, images_raw_len: nextRaw.length, duration_ms: Date.now() - t0 });
});
