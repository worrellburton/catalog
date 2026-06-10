// analyze-look-media — Claude Vision pass over a look's photo or video
// frame. Returns a small set of "products visible in this image"
// candidates so the consumer Create-a-Look flow can pre-populate the
// product picker instead of asking the user to type every item.
//
// Wire: client POSTs a base64-encoded image (JPEG or PNG, from a
// <canvas> snapshot for videos or the file itself for photos). We hand
// it to Claude with a strict JSON-only prompt, parse the response, and
// return an array of { brand, name, type, color, price?, url? }.
//
// Required Supabase secret:
//   ANTHROPIC_API_KEY = sk-ant-xxxxxxxx

import { logAiUsage } from '../_shared/ai-usage.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// What we expose to the client. Shape mirrors AddProductInput in
// app/services/manage-looks.ts so a found row can be passed straight
// through to addProductToLook without translation.
interface DetectedProduct {
  brand: string;
  name: string;
  type: string | null;
  color: string | null;
  notes: string | null;
}

interface ClaudeResponse {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

const SYSTEM_PROMPT = `You analyze fashion outfit photos.
You will be given ONE image of a person (or product flat-lay). Your job is to
list each distinct WEARABLE / SHOPPABLE item visible in the image — clothing,
shoes, bags, jewelry, eyewear, watches, hats.

Return STRICT JSON only (no prose, no markdown fences), shaped exactly:
{
  "products": [
    {
      "brand": "<best guess at brand if visible/recognizable; empty string if not>",
      "name": "<short, specific noun phrase, e.g. \\"cream linen camp shirt\\" or \\"black leather Chelsea boots\\">",
      "type": "<one of: top, bottom, dress, outerwear, shoes, bag, accessory, jewelry, eyewear, headwear, watch>",
      "color": "<dominant color of the item>",
      "notes": "<short detail that helps a shopper find it: material, silhouette, length>"
    }
  ]
}

Rules:
- Include AT MOST 6 items. Pick the most distinct, shoppable ones.
- Skip skin, undergarments not visible, and props (drinks, plants, phones).
- Do NOT invent brands. Leave "brand": "" unless you can see a logo or
  the silhouette is unmistakable (e.g. Birkenstocks, AJ1s).
- Never wrap the JSON in markdown. Never add commentary. JSON only.`;

async function callClaude(base64: string, mediaType: 'image/jpeg' | 'image/png' | 'image/webp', apiKey: string): Promise<{ products: DetectedProduct[]; inputTokens: number | null; outputTokens: number | null; }> {
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          { type: 'text', text: 'Identify the shoppable items in this image. Return JSON only.' },
        ],
      },
    ],
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as ClaudeResponse;
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `Claude vision call failed (${res.status})`);
  }
  const text = data.content?.find(b => b.type === 'text')?.text || '';
  // Strip any stray fences just in case the model adds them despite the
  // instructions — same defensive parse as catalog-brainstorm.
  const clean = text.replace(/```json\s*|\s*```/g, '').trim();
  let parsed: { products?: DetectedProduct[] };
  try {
    parsed = JSON.parse(clean);
  } catch {
    parsed = { products: [] };
  }
  const products: DetectedProduct[] = Array.isArray(parsed.products)
    ? parsed.products
        .filter(p => p && typeof p === 'object' && typeof p.name === 'string' && p.name.trim().length > 0)
        .slice(0, 6)
        .map(p => ({
          brand: typeof p.brand === 'string' ? p.brand.trim() : '',
          name: p.name.trim(),
          type: typeof p.type === 'string' ? p.type.trim() : null,
          color: typeof p.color === 'string' ? p.color.trim() : null,
          notes: typeof p.notes === 'string' ? p.notes.trim() : null,
        }))
    : [];
  return {
    products,
    inputTokens: data.usage?.input_tokens ?? null,
    outputTokens: data.usage?.output_tokens ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonRes({ error: 'POST only' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return jsonRes({ error: 'ANTHROPIC_API_KEY not configured' }, 500);

  let payload: { image_base64?: string; media_type?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonRes({ error: 'Invalid JSON body' }, 400);
  }

  const base64 = (payload.image_base64 || '').replace(/^data:image\/\w+;base64,/, '');
  if (!base64) return jsonRes({ error: 'image_base64 is required' }, 400);
  // Cap at ~5 MB encoded to stay inside Claude's image size limit and
  // keep request bodies sane. Client should already be downscaling.
  if (base64.length > 7_500_000) return jsonRes({ error: 'image_base64 too large (max ~5 MB decoded)' }, 413);

  const mt = (payload.media_type || 'image/jpeg').toLowerCase();
  const mediaType: 'image/jpeg' | 'image/png' | 'image/webp' =
    mt === 'image/png' ? 'image/png' :
    mt === 'image/webp' ? 'image/webp' :
    'image/jpeg';

  try {
    const t0 = Date.now();
    const { products, inputTokens, outputTokens } = await callClaude(base64, mediaType, apiKey);
    void logAiUsage({
      platform: 'anthropic',
      operation: 'analyze-look-media',
      model: 'claude-sonnet-4-6',
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      status: 'success',
      metadata: { product_count: products.length, ms: Date.now() - t0 },
    });
    return jsonRes({ products });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logAiUsage({
      platform: 'anthropic',
      operation: 'analyze-look-media',
      model: 'claude-sonnet-4-6',
      status: 'error',
      error_message: message,
    });
    return jsonRes({ error: message }, 500);
  }
});
