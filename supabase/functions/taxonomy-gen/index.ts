// taxonomy-gen — generate synonyms and search keywords for a product type.
// Called from the admin taxonomy page when a user clicks "Generate" on a row.
//
// Required Supabase secret:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx

import { logAiUsage } from '../_shared/ai-usage.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface ClaudeMessage {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

async function generateSynonyms(
  type: string,
  category: string | null,
  apiKey: string,
): Promise<{ synonyms: string[]; keywords: string; inputTokens: number | null; outputTokens: number | null }> {
  const categoryHint = category ? ` (category: ${category})` : '';
  const prompt = `You are a catalog search expert. Generate synonyms and keywords for the product type "${type}"${categoryHint}.

Return ONLY a JSON object with these exact fields:
- "synonyms": array of 6-10 common user search terms that mean the same thing or are very closely related to "${type}". These are what a shopper would actually type in a search box. Include common misspellings, alternate spellings, brand-generic terms, and colloquialisms.
- "keywords": a short comma-separated string of 3-6 descriptive keywords that help rank items of this type (e.g. material, style, occasion words). These augment BM25 ranking for within-type searches.

Examples:
- type "Haircare", category "beauty" → {"synonyms":["hair cream","hair oil","hair mask","hair serum","shampoo","conditioner","hair treatment","hair product","hair care","scalp treatment"],"keywords":"moisturizing, nourishing, frizz-free, shine"}
- type "Decor", category "home" → {"synonyms":["candle","candles","home decor","decorative","ornament","vase","centerpiece","wall art","room decor","interior decor"],"keywords":"aesthetic, cozy, minimalist, boho"}
- type "Sneakers", category "fashion" → {"synonyms":["sneakers","trainers","kicks","athletic shoes","running shoes","tennis shoes","casual shoes","low tops","high tops"],"keywords":"comfortable, casual, streetwear, sport"}

Respond with ONLY the JSON object, no prose, no markdown fences.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const json = await res.json() as ClaudeMessage;
  const text = json.content?.find(b => b.type === 'text')?.text ?? '';
  const cleaned = text.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim();
  const raw = JSON.parse(cleaned) as { synonyms?: unknown; keywords?: unknown };

  const synonyms = Array.isArray(raw.synonyms)
    ? (raw.synonyms as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 12)
    : [];
  const keywords = typeof raw.keywords === 'string' ? raw.keywords : '';

  return {
    synonyms,
    keywords,
    inputTokens: json.usage?.input_tokens ?? null,
    outputTokens: json.usage?.output_tokens ?? null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonRes({ ok: false, error: 'Use POST' }, 405);

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  if (!anthropicKey) return jsonRes({ ok: false, error: 'ANTHROPIC_API_KEY not configured' }, 500);

  const supabaseUrl  = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return jsonRes({ ok: false, error: 'Supabase env missing' }, 500);

  let body: { type?: string; category?: string | null };
  try { body = await req.json(); } catch { return jsonRes({ ok: false, error: 'Invalid JSON' }, 400); }

  const { type, category = null } = body;
  if (!type?.trim()) return jsonRes({ ok: false, error: 'type required' }, 400);

  try {
    const { synonyms, keywords, inputTokens, outputTokens } = await generateSynonyms(type.trim(), category ?? null, anthropicKey);
    logAiUsage({
      platform: 'anthropic',
      operation: 'taxonomy-gen',
      model: 'claude-haiku-4-5-20251001',
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      metadata: { type: type.trim(), category: category ?? null },
    });

    // Persist the result back to product_taxonomy using the service role key.
    // We do this server-side so the browser never needs the service key.
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const admin = createClient(supabaseUrl, serviceKey);
    const { error: upsertErr } = await admin
      .from('product_taxonomy')
      .upsert(
        {
          type:         type.trim(),
          category:     category ?? null,
          synonyms,
          keywords,
          generated_at: new Date().toISOString(),
          updated_at:   new Date().toISOString(),
        },
        { onConflict: 'type' },
      );

    if (upsertErr) {
      console.warn('[taxonomy-gen] upsert failed:', upsertErr);
      // Still return the generated data so the UI can show it.
    }

    return jsonRes({ ok: true, type: type.trim(), synonyms, keywords });
  } catch (err) {
    console.error('[taxonomy-gen] error:', err);
    return jsonRes({ ok: false, error: String(err) }, 500);
  }
});
