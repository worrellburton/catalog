// extract-product-screenshot — Claude vision for the admin "Add Manually"
// product flow. The admin uploads a screenshot of a product page (or ad);
// Claude reads it and returns the structured fields (name, brand, price,
// currency, description, type, gender) that prefill the manual-product
// form. No DB writes here — the admin reviews and saves from the client.
//
// Required secret: ANTHROPIC_API_KEY.

const MODEL = 'claude-sonnet-4-6';
const MAX_IMAGE_B64 = 6_000_000; // ~4.5MB binary — plenty for a screenshot

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

interface ClaudeResponse {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

const ALLOWED_MEDIA = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonRes({ error: 'POST only' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return jsonRes({ error: 'ANTHROPIC_API_KEY not configured' }, 500);

  try {
    const body = await req.json().catch(() => ({}));
    const imageB64 = typeof body.image_base64 === 'string' ? body.image_base64 : '';
    const mediaType = ALLOWED_MEDIA.has(body.media_type) ? body.media_type as string : 'image/png';
    if (!imageB64) return jsonRes({ error: 'image_base64 required' }, 400);
    if (imageB64.length > MAX_IMAGE_B64) return jsonRes({ error: 'image too large (max ~4.5MB)' }, 413);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageB64 } },
            {
              type: 'text',
              text: `This is a screenshot of a product (a product page, listing, or ad).
Extract the product details. Return ONLY a JSON object — no prose, no code fences:

{
  "name": "product name without the brand prefix",
  "brand": "brand name or empty string",
  "price": "numeric price as shown, digits and separators only (e.g. 128.00), empty if not visible",
  "currency": "ISO code like USD/EUR/GBP, empty if unknown",
  "description": "1-2 sentence product description from visible text (or a faithful summary)",
  "type": "lowercase product type, e.g. jeans, dress, sneakers, candle, laptop",
  "gender": "men | women | unisex (best judgement from the product/context)"
}

If a field truly isn't determinable, use an empty string.`,
            },
          ],
        }],
      }),
    });
    if (!res.ok) return jsonRes({ error: `Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}` }, 502);

    const json = (await res.json()) as ClaudeResponse;
    const text = json.content?.find(c => c.type === 'text')?.text?.trim() ?? '';
    const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return jsonRes({ error: 'no JSON in model response' }, 502);
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;

    const str = (k: string) => (typeof parsed[k] === 'string' ? (parsed[k] as string).trim() : '');
    const gender = ['men', 'women', 'unisex'].includes(str('gender')) ? str('gender') : '';
    return jsonRes({
      success: true,
      fields: {
        name: str('name'),
        brand: str('brand'),
        price: str('price'),
        currency: str('currency'),
        description: str('description'),
        type: str('type').toLowerCase(),
        gender,
      },
      usage: { input_tokens: json.usage?.input_tokens ?? null, output_tokens: json.usage?.output_tokens ?? null },
    });
  } catch (e) {
    return jsonRes({ error: String(e).slice(0, 300) }, 500);
  }
});
