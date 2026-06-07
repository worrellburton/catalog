// Generates (and caches) a UNIQUE description for a single look. Gemini is
// shown the look's poster frame (the still that the consumer feed paints) plus
// the list of products featured in the look, and writes 1-2 grounded sentences
// about that specific outfit. The result is cached in look_descriptions keyed
// by look_id so we only call the model once per look.
//
// Why per-look + image-grounded: every look used to fall back to a single
// creator-level "about" blurb, so unrelated looks under the same creator all
// read identically and often referenced brands that weren't even in the look.
// Feeding Gemini the actual frame + the actual products fixes both.
//
// Secrets used:
//   GOOGLE_API_KEY  — Gemini (GEMINI_API_KEY also accepted). Without it we
//                     fall back to a deterministic product-based heuristic.
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — cache read/write.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Fire-and-forget usage log to ai_usage_logs. Inlined (rather than importing
// ../_shared/ai-usage.ts) so the function bundles standalone. Never throws.
interface AiUsageLog {
  platform: string;
  operation: string;
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  status?: 'success' | 'error';
  error_message?: string | null;
  metadata?: Record<string, unknown> | null;
}
async function logAiUsage(log: AiUsageLog): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !key) return;
  try {
    await fetch(`${url}/rest/v1/ai_usage_logs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        platform: log.platform,
        operation: log.operation,
        model: log.model ?? null,
        input_tokens: log.input_tokens ?? null,
        output_tokens: log.output_tokens ?? null,
        status: log.status ?? 'success',
        error_message: log.error_message ?? null,
        metadata: log.metadata ?? null,
      }),
    });
  } catch {
    // best-effort
  }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

// Looks are largely static once published, so regenerate rarely.
const FRESH_DAYS = 180;
const MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const IMAGE_TIMEOUT_MS = 8_000;
const GEMINI_TIMEOUT_MS = 20_000;

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface ProductInput {
  brand?: string | null;
  name?: string | null;
  type?: string | null;
  price?: string | null;
}

// Chunked base64 so a large frame can't blow the call stack (btoa on a long
// binary string does on some inputs).
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function productLines(products: ProductInput[]): string {
  return products
    .map((p) => {
      const bits = [p.brand, p.name].filter(Boolean).join(' — ');
      const tail = [p.type, p.price].filter(Boolean).join(', ');
      return tail ? `- ${bits} (${tail})` : `- ${bits}`;
    })
    .filter((l) => l.length > 2)
    .join('\n');
}

// Deterministic, no-model fallback. Still unique per look because it's built
// from that look's specific products.
function heuristicDescription(title: string, products: ProductInput[]): string {
  const brands = [...new Set(products.map((p) => (p.brand || '').trim()).filter(Boolean))];
  const types = [...new Set(products.map((p) => (p.type || '').trim().toLowerCase()).filter(Boolean))];
  if (brands.length === 0 && types.length === 0) {
    return title ? `${title} — a curated look you can shop end to end.` : 'A curated look you can shop end to end.';
  }
  const piece = types.length ? types.slice(0, 3).join(', ') : 'pieces';
  const by = brands.length ? ` from ${brands.slice(0, 3).join(', ')}` : '';
  return `A look built around ${piece}${by} — every piece is shoppable.`;
}

async function fetchImageInline(url: string): Promise<{ mime: string; data: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IMAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const mime = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
    if (!mime.startsWith('image/')) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0) return null;
    return { mime, data: bytesToBase64(bytes) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const PROMPT_INTRO = `You write vivid, specific descriptions of fashion "looks" for a shopping app.

You are shown a still frame from the look's video and the exact list of products featured in it. Write ONE to TWO sentences (max ~40 words) describing THIS specific look: the vibe, how the pieces come together, and what occasion or mood it suits. Ground every detail in what you can actually see in the image and in the product list — do not invent brands or items that aren't listed.

Rules:
- Be concrete and sensory, never generic or salesy.
- Do NOT use the words "curate/curated", "elevate", "effortless", "fashionista", "vibe check", or "stunning".
- Do NOT mention the creator's name, the app, or "this look".
- Do NOT use hashtags, emoji, or quotation marks.
- Return ONLY the sentence(s).`;

async function describeWithGemini(
  title: string,
  products: ProductInput[],
  image: { mime: string; data: string } | null,
  apiKey: string,
): Promise<{ text: string; inputTokens: number | null; outputTokens: number | null }> {
  const facts = `Look title: ${title || '(untitled)'}\nProducts in this look:\n${productLines(products) || '(none listed)'}`;
  const parts: Array<Record<string, unknown>> = [{ text: `${PROMPT_INTRO}\n\n${facts}` }];
  if (image) parts.push({ inline_data: { mime_type: image.mime, data: image.data } });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { maxOutputTokens: 200, temperature: 0.8 },
      }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const raw = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`gemini_${res.status}:${raw.slice(0, 300)}`);
  let parsed: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  try { parsed = JSON.parse(raw); } catch { throw new Error('gemini_bad_json'); }
  const text = (parsed.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || '')
    .join('')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
  if (!text) throw new Error('gemini_no_text');
  return {
    text,
    inputTokens: parsed.usageMetadata?.promptTokenCount ?? null,
    outputTokens: parsed.usageMetadata?.candidatesTokenCount ?? null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const db = createClient(supabaseUrl, serviceRoleKey);

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const lookId = String(body.lookId || '').trim();
    const title = String(body.title || '').trim();
    const imageUrl = String(body.imageUrl || '').trim();
    const products: ProductInput[] = Array.isArray(body.products) ? body.products.slice(0, 12) : [];
    const force = body.force === true;

    if (!lookId) return jsonRes({ success: false, error: 'missing lookId' }, 400);

    // Serve a fresh cached description without hitting the model.
    if (!force) {
      const { data: cached } = await db
        .from('look_descriptions')
        .select('description, generated_at')
        .eq('look_id', lookId)
        .maybeSingle();
      if (cached?.description) {
        const ageDays = (Date.now() - Date.parse(cached.generated_at)) / 86_400_000;
        if (ageDays < FRESH_DAYS) {
          return jsonRes({ success: true, description: cached.description, source: 'cache' });
        }
      }
    }

    const apiKey = Deno.env.get('GOOGLE_API_KEY') || Deno.env.get('GEMINI_API_KEY') || '';
    let description: string;
    let source: string;

    if (!apiKey) {
      description = heuristicDescription(title, products);
      source = 'heuristic';
    } else {
      try {
        const image = imageUrl ? await fetchImageInline(imageUrl) : null;
        const out = await describeWithGemini(title, products, image, apiKey);
        description = out.text;
        source = image ? 'gemini+image' : 'gemini';
        logAiUsage({
          platform: 'google',
          operation: 'look-description',
          model: MODEL,
          input_tokens: out.inputTokens,
          output_tokens: out.outputTokens,
          metadata: { has_image: !!image },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logAiUsage({
          platform: 'google',
          operation: 'look-description',
          model: MODEL,
          status: 'error',
          error_message: msg.slice(0, 500),
        });
        description = heuristicDescription(title, products);
        source = 'heuristic';
      }
    }

    await db
      .from('look_descriptions')
      .upsert(
        { look_id: lookId, description, source, generated_at: new Date().toISOString() },
        { onConflict: 'look_id' },
      );

    return jsonRes({ success: true, description, source });
  } catch (err) {
    return jsonRes({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
