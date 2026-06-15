// haiku-context — Claude Haiku looks at a product's primary image and
// writes a two-line description, stored on products.haiku_context:
//   Line 1 — the object's identity in a few plain words ("houseplant",
//            "high heels"), naming only the item, never the setting.
//   Line 2 — one dense detail sentence (materials, colors, notable bits).
//
// This context exists for TYPE GOVERNANCE: product names lie ("Latte
// Art – Woodland" reads as art; the photo shows glassware), so kaizen's
// placement matching and the kaizen-refine prompt both read it. Matching
// uses ONLY line 1 (see haikuIdentity) so a plant shot in a living room
// isn't dragged under "home" by the detail sentence.
//
// Invoked by the products_haiku_context trigger whenever a primary
// image is picked (body {productId}), or with {backfill: N} to process
// up to N products that have an image but no context yet.
//
// Auth mirrors kaizen (service key by value or capability probe).
// Secrets: ANTHROPIC_API_KEY.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MODEL = 'claude-haiku-4-5-20251001';
const IMAGE_FETCH_TIMEOUT_MS = 10_000;

function b64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

async function fetchImage(url: string): Promise<{ media_type: string; data: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    // Shrink via the render endpoint when it's our storage (vision needs
    // shape, not pixels) — foreign URLs pass through untouched.
    const small = /\/storage\/v1\/object\/public\//.test(url)
      ? url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + (url.includes('?') ? '&' : '?') + 'width=512&quality=75&resize=contain'
      : url;
    const res = await fetch(small, { signal: ctrl.signal });
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0];
    if (!mime.startsWith('image/')) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 4_500_000) return null;
    return { media_type: mime, data: b64(bytes) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// deno-lint-ignore no-explicit-any
async function describeOne(supabase: any, apiKey: string, productId: string): Promise<boolean> {
  const { data: p } = await supabase
    .from('products').select('id, name, brand, primary_image_url, image_url')
    .eq('id', productId).maybeSingle();
  if (!p) return false;
  const imgUrl = p.primary_image_url || p.image_url;
  if (!imgUrl) return false;
  const image = await fetchImage(imgUrl);
  if (!image) return false;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.data } },
          { type: 'text', text: `Product title: "${p.name}"${p.brand ? ` by ${p.brand}` : ''}.\n\nIdentify what this item ACTUALLY is from the photo — titles often mislead, so trust the image.\n\nReply in EXACTLY two lines, nothing else:\nLine 1 — the item's category in 1-4 plain words, using the most common everyday noun for it (e.g. "houseplant", "high heels", "computer monitor", "wristwatch", "denim jacket", "table lamp"). Name only the object itself. Do NOT mention the room, background, setting, surroundings, or where it sits.\nLine 2 — one dense sentence: materials, colors, and any notable detail.\n\nNo marketing language.` },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const out = await res.json() as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
  const text = (out.content?.find(c => c.type === 'text')?.text ?? '').trim();
  if (!text) return false;

  await supabase.from('products')
    .update({ haiku_context: text, haiku_context_at: new Date().toISOString() })
    .eq('id', productId);
  void supabase.from('ai_usage_logs').insert({
    platform: 'anthropic', operation: 'haiku-context', model: MODEL,
    input_tokens: out.usage?.input_tokens ?? null, output_tokens: out.usage?.output_tokens ?? null, status: 'success',
  });
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  let isService = !!serviceKey && bearer === serviceKey;
  if (!isService && bearer) {
    const probe = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=1`, {
      headers: { apikey: bearer, Authorization: `Bearer ${bearer}` },
    });
    isService = probe.ok;
  }
  if (!isService) return new Response(JSON.stringify({ success: false, error: 'service only' }), { status: 403 });
  if (!apiKey) return new Response(JSON.stringify({ success: false, error: 'ANTHROPIC_API_KEY not set' }), { status: 500 });
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const productId = typeof body.productId === 'string' ? body.productId : null;
    const backfill = Number(body.backfill) || 0;

    if (productId) {
      const ok = await describeOne(supabase, apiKey, productId);
      return new Response(JSON.stringify({ success: ok }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (backfill > 0) {
      const { data: rows } = await supabase
        .from('products').select('id')
        .is('haiku_context', null)
        .not('primary_image_url', 'is', null)
        .eq('is_active', true)
        .limit(Math.min(backfill, 25));
      let done = 0;
      for (const r of (rows ?? []) as Array<{ id: string }>) {
        try { if (await describeOne(supabase, apiKey, r.id)) done++; }
        catch { /* skip and continue the batch */ }
      }
      return new Response(JSON.stringify({ success: true, done, remaining_query: 'haiku_context is null' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: false, error: 'pass productId or backfill' }), { status: 400 });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }), { status: 500 });
  }
});
