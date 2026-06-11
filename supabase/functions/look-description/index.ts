// Generates (and caches) a UNIQUE editorial commentary for a single look.
// Gemini PRO is shown the look's actual video clip, the product photos, and
// each product's brand/type/price, and writes 3-4 fun, sophisticated
// sentences of commentary. Cached in look_descriptions keyed by look_id;
// pre-pro cached rows regenerate organically on next request.
//
// Callable two ways:
//   1. With { lookId, title, imageUrl, products } from the client (on view).
//   2. With just { lookId } from the looks_creative DB trigger — the function
//      then self-fetches title, poster frame, and products server-side, so a
//      unique description is generated automatically every time a look is made.
//
// Secrets: GOOGLE_API_KEY (or GEMINI_API_KEY); SUPABASE_URL / SERVICE_ROLE_KEY.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

const FRESH_DAYS = 180;
// Top-shelf Gemini (founder's call): the description is a piece of
// editorial content people should WANT to read, so it gets the pro model,
// the actual video, and the product images — not a single still on flash.
const MODEL = 'gemini-2.5-pro';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const IMAGE_TIMEOUT_MS = 8_000;
const VIDEO_TIMEOUT_MS = 20_000;
const GEMINI_TIMEOUT_MS = 60_000;
/** Inline-data budget for the clip (Gemini inline request cap is ~20MB
 *  total; the 480w mobile variant of a look runs 1.5–5MB). */
const VIDEO_MAX_BYTES = 14_000_000;
const PRODUCT_IMAGE_MAX = 4;

/** Small rendition of a Supabase-storage image so four product shots
 *  don't blow the request budget; non-storage URLs pass through. */
function smallRendition(url: string): string {
  if (!/\/storage\/v1\/object\/public\//.test(url)) return url;
  return url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + '?width=512&quality=75&resize=contain';
}

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

function heuristicDescription(title: string, products: ProductInput[]): string {
  const brands = [...new Set(products.map((p) => (p.brand || '').trim()).filter(Boolean))];
  const types = [...new Set(products.map((p) => (p.type || '').trim().toLowerCase()).filter(Boolean))];
  if (brands.length === 0 && types.length === 0) {
    return title ? `${title} — a look you can shop end to end.` : 'A look you can shop end to end.';
  }
  const piece = types.length ? types.slice(0, 3).join(', ') : 'pieces';
  const by = brands.length ? ` from ${brands.slice(0, 3).join(', ')}` : '';
  return `A look built around ${piece}${by} — every piece is shoppable.`;
}

async function fetchInline(
  url: string,
  kind: 'image' | 'video',
): Promise<{ mime: string; data: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), kind === 'video' ? VIDEO_TIMEOUT_MS : IMAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const fallback = kind === 'video' ? 'video/mp4' : 'image/jpeg';
    const mime = res.headers.get('content-type')?.split(';')[0] || fallback;
    if (!mime.startsWith(`${kind}/`)) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0) return null;
    if (kind === 'video' && bytes.length > VIDEO_MAX_BYTES) return null;
    return { mime, data: bytesToBase64(bytes) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const PROMPT_INTRO = `You are a sharp, funny fashion-and-culture writer doing a short commentary on a shoppable "look" video. You are given the actual video clip, photos of the exact products in it, and each product's brand, type, and price.

Write THREE to FOUR sentences of commentary on this specific look. This is editorial, not ad copy: have a point of view, notice the telling detail (how something moves in the video, an unexpected pairing, what the price says, where this outfit is clearly headed), and land at least one genuinely witty or surprising line. Sophisticated, playful, a little knowing — the kind of writing people read to the end and quote to a friend.

Rules:
- Ground everything in what is actually visible in the video, the product photos, and the listed facts. Never invent brands, items, or details.
- You may open with a short punchy fragment (two to four words) if it earns its place.
- Be concrete and sensory, never generic or salesy.
- Do NOT use the words "curate/curated", "elevate", "effortless", "fashionista", "vibe check", "stunning", or "serving".
- Do NOT mention the creator's name, the app, or the phrase "this look".
- Do NOT use hashtags, emoji, or quotation marks.
- Return ONLY the sentences.`;

async function describeWithGemini(
  title: string,
  products: ProductInput[],
  media: Array<{ mime: string; data: string }>,
  apiKey: string,
): Promise<{ text: string; inputTokens: number | null; outputTokens: number | null }> {
  const facts = `Look title: ${title || '(untitled)'}\nProducts in this look (brand — name (type, price)):\n${productLines(products) || '(none listed)'}`;
  const parts: Array<Record<string, unknown>> = [{ text: `${PROMPT_INTRO}\n\n${facts}` }];
  for (const m of media) parts.push({ inline_data: { mime_type: m.mime, data: m.data } });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { maxOutputTokens: 2000, temperature: 0.9, thinkingConfig: { thinkingBudget: 512 } },
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
    let title = String(body.title || '').trim();
    let imageUrl = String(body.imageUrl || '').trim();
    let products: ProductInput[] = Array.isArray(body.products) ? body.products.slice(0, 12) : [];
    const force = body.force === true;

    if (!lookId) return jsonRes({ success: false, error: 'missing lookId' }, 400);

    // Cache fast-path — return a fresh cached description without any work.
    if (!force) {
      const { data: cached } = await db
        .from('look_descriptions')
        .select('description, generated_at, source')
        .eq('look_id', lookId)
        .maybeSingle();
      if (cached?.description) {
        const ageDays = (Date.now() - Date.parse(cached.generated_at)) / 86_400_000;
        // Only the current style (pro model + video commentary) counts as
        // fresh — older flash/heuristic blurbs regenerate on next request.
        const currentStyle = String(cached.source || '').startsWith('gemini-pro');
        if (ageDays < FRESH_DAYS && currentStyle) {
          return jsonRes({ success: true, description: cached.description, source: 'cache' });
        }
      }
    }

    // Self-fetch path: a DB trigger (and any caller) can invoke with just a
    // lookId; we resolve the title, poster frame, and products server-side.
    // This is what makes per-look descriptions fully automatic — the
    // looks_creative trigger fires the moment a look's poster is set, with no
    // client involvement. Prefer the look's own poster frame as the image
    // Gemini analyzes; fall back to a product image.
    if (!title || !imageUrl || products.length === 0) {
      const { data: lookRow } = await db
        .from('looks')
        .select('title')
        .eq('id', lookId)
        .maybeSingle();
      if (lookRow && !title) title = String(lookRow.title || '').trim();

      if (!imageUrl) {
        const { data: creative } = await db
          .from('looks_creative')
          .select('thumbnail_url')
          .eq('look_id', lookId)
          .eq('is_primary', true)
          .maybeSingle();
        if (creative?.thumbnail_url) imageUrl = String(creative.thumbnail_url);
      }

      if (products.length === 0) {
        const { data: lps } = await db
          .from('look_products')
          .select('products ( brand, name, type, price, image_url, primary_image_url )')
          .eq('look_id', lookId)
          .limit(12);
        const rows = (lps || [])
          .map((r: { products: (ProductInput & { image_url?: string | null; primary_image_url?: string | null }) | null }) => r.products)
          .filter((p): p is ProductInput & { image_url?: string | null; primary_image_url?: string | null } => !!p);
        products = rows.map((p) => ({ brand: p.brand, name: p.name, type: p.type, price: p.price }));
        if (!imageUrl) {
          const firstImg = rows.find((p) => p.primary_image_url || p.image_url);
          if (firstImg) imageUrl = String(firstImg.primary_image_url || firstImg.image_url);
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
        // The ACTUAL clip (mobile rendition keeps the payload small) plus
        // up to four product photos ride along with the facts.
        const { data: creativeRow } = await db
          .from('looks_creative')
          .select('mobile_video_url, video_url')
          .eq('look_id', lookId)
          .eq('is_primary', true)
          .maybeSingle();
        const videoUrl = String(creativeRow?.mobile_video_url || creativeRow?.video_url || '').trim();

        const { data: lpRows } = await db
          .from('look_products')
          .select('products ( image_url, primary_image_url )')
          .eq('look_id', lookId)
          .limit(PRODUCT_IMAGE_MAX);
        const productImageUrls = (lpRows || [])
          .map((r: { products: { image_url?: string | null; primary_image_url?: string | null } | null }) =>
            r.products?.primary_image_url || r.products?.image_url || null)
          .filter((u: string | null): u is string => !!u)
          .slice(0, PRODUCT_IMAGE_MAX);

        const media: Array<{ mime: string; data: string }> = [];
        const video = videoUrl ? await fetchInline(videoUrl, 'video') : null;
        if (video) media.push(video);
        for (const u of productImageUrls) {
          const img = await fetchInline(smallRendition(u), 'image');
          if (img) media.push(img);
        }
        // No video came back (missing / oversized): fall back to the
        // poster frame so the model still SEES the look.
        if (!video && imageUrl) {
          const poster = await fetchInline(imageUrl, 'image');
          if (poster) media.unshift(poster);
        }

        const out = await describeWithGemini(title, products, media, apiKey);
        description = out.text;
        source = video ? 'gemini-pro+video' : media.length > 0 ? 'gemini-pro+image' : 'gemini-pro';
        logAiUsage({
          platform: 'google',
          operation: 'look-description',
          model: MODEL,
          input_tokens: out.inputTokens,
          output_tokens: out.outputTokens,
          metadata: { has_video: !!video, product_images: productImageUrls.length },
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
        { onConflict: 'look_id', ignoreDuplicates: source === 'heuristic' },
      );

    return jsonRes({ success: true, description, source });
  } catch (err) {
    return jsonRes({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
