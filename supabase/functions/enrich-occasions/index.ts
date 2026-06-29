// enrich-occasions — writes search-facing occasion/use-case metadata to
// products.styling_metadata.occasion (string[]) + product_taxonomy.style.
// This is the surfacing signal product_ready_for_feed() and the search BM25
// lane key off. Auto path for what was previously the manual
// scripts/enrich-occasions-v2.mjs. Category-HONEST prompt (a detergent gets
// "laundry day", NOT "date night"). Non-destructive: only overwrites the
// `occasion` key + `style`, bumps enrichment_version to >=2.
//
// Modes:
//   POST { id: "<uuid>" }     enrich one product
//   POST { backfill: 20 }     enrich up to N products missing occasion
//
// Secret: ANTHROPIC_API_KEY. Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

const MODEL = 'claude-haiku-4-5-20251001';
const ENRICHMENT_VERSION = 2;

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface ProductRow {
  id: string;
  name: string | null;
  brand: string | null;
  type: string | null;
  gender: string | null;
  description: string | null;
  styling_metadata: Record<string, unknown> | null;
  product_taxonomy: Record<string, unknown> | null;
  enrichment_version: number | null;
}

function buildPrompt(p: ProductRow): string {
  return `You write SEARCH metadata for a shopping app that sells ALL kinds of products — clothing, shoes, accessories, beauty, haircare, home decor, books, food, household items, anything.

For the product below, list the real-world OCCASIONS, SETTINGS, ACTIVITIES, and USE-CASES a shopper would have in mind when searching for this exact item. Be HONEST and literal to what the product actually is — do NOT force lifestyle or fashion framing onto utilitarian items.

Examples:
- Cocktail dress → ["date night","cocktail party","wedding guest","night out","dinner party","going out"]
- Laundry detergent → ["laundry day","household chores","stain removal","dorm essentials","everyday cleaning"]
- Romance novel → ["cozy weekend read","beach read","book club","relaxing evening","gift for readers"]
- Running shoes → ["running","gym workout","marathon training","athleisure","everyday sneakers"]
- Scented candle → ["cozy night in","home ambiance","relaxation","housewarming gift","self-care"]
- Cashmere hoodie → ["cozy weekend","lounging at home","travel comfort","chilly evenings","casual layering"]

Product:
  Name: ${p.name || 'Unknown'}
  Brand: ${p.brand || 'Unknown'}
  Type: ${p.type || 'Unknown'}
  Gender: ${p.gender || 'unisex'}
  Description: ${(p.description || 'n/a').slice(0, 400)}

Rules:
- 4-8 short, lowercase, natural-search phrases. Only ones that GENUINELY fit.
- "style": one word vibe if clearly applicable (minimal, athletic, bohemian, utilitarian, luxury, classic, edgy, preppy, cozy) else null.
Return ONLY JSON: {"occasions":["..."],"style":"..."|null}`;
}

async function callClaude(prompt: string, apiKey: string): Promise<{ occasions: string[]; style: string | null } | null> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const text: string = json?.content?.find((c: { type: string }) => c.type === 'text')?.text?.trim() ?? '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const occasions = Array.isArray(parsed.occasions)
      ? parsed.occasions.map(String).map((s: string) => s.trim().toLowerCase()).filter(Boolean).slice(0, 8)
      : [];
    const style = typeof parsed.style === 'string' && parsed.style.trim() ? parsed.style.trim().toLowerCase() : null;
    return { occasions, style };
  } catch {
    return null;
  }
}

async function enrichOne(
  admin: ReturnType<typeof createClient>,
  p: ProductRow,
  apiKey: string,
): Promise<boolean> {
  const result = await callClaude(buildPrompt(p), apiKey);
  if (!result || !result.occasions.length) return false;

  const styling = { ...(p.styling_metadata ?? {}), occasion: result.occasions };
  const taxonomy = result.style
    ? { ...(p.product_taxonomy ?? {}), style: result.style }
    : p.product_taxonomy;

  const { error } = await admin
    .from('products')
    .update({
      styling_metadata: styling,
      product_taxonomy: taxonomy,
      enrichment_version: Math.max(p.enrichment_version ?? 0, ENRICHMENT_VERSION),
    })
    .eq('id', p.id);
  return !error;
}

const SELECT = 'id, name, brand, type, gender, description, styling_metadata, product_taxonomy, enrichment_version';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
    if (!apiKey) return jsonRes({ success: false, error: 'ANTHROPIC_API_KEY not configured' }, 500);
    const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');

    const body = await req.json().catch(() => ({}));

    // Single-product mode
    if (body.id) {
      const { data: p } = await admin.from('products').select(SELECT).eq('id', body.id).maybeSingle();
      if (!p) return jsonRes({ success: false, error: 'product not found' }, 404);
      const ok = await enrichOne(admin, p as ProductRow, apiKey);
      return jsonRes({ success: ok, id: body.id });
    }

    // Backfill mode — products missing occasion (have an image so they're worth surfacing)
    const limit = Math.max(1, Math.min(50, Number(body.backfill) || 20));
    const { data: rows } = await admin
      .from('products')
      .select(SELECT)
      .or('styling_metadata->occasion.is.null,styling_metadata.is.null')
      .not('image_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit);

    const list = (rows ?? []) as ProductRow[];
    let enriched = 0;
    for (const p of list) {
      if (await enrichOne(admin, p, apiKey)) enriched++;
    }
    return jsonRes({ success: true, processed: list.length, enriched });
  } catch (err) {
    return jsonRes({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
