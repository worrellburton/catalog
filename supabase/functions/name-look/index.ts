// name-look — Claude generates a short display name for a user
// generation based on the products + style + age that went into it.
//
// Called fire-and-forget from the client after a generation is
// submitted. The function looks up the generation row, asks Claude
// for a 2-4 word name, and writes the result back to
// user_generations.display_name. The LookCard renders display_name
// when present, otherwise falls back to the style preset label.
//
// Failure modes (network, Claude rate limit, empty response) leave
// display_name null — the fallback handles it. This is best-effort
// styling, not a critical path.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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

interface LookContext {
  style: string | null;
  age_label: string | null;
  height_cm: number | null;
  products: Array<{ name: string | null; brand: string | null; role_tag: string | null }>;
}

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-3-5-haiku-20241022';

function buildPrompt(ctx: LookContext): string {
  const productLines = ctx.products
    .filter(p => p.name || p.brand)
    .slice(0, 8)
    .map(p => {
      const name = [p.brand, p.name].filter(Boolean).join(' ');
      return p.role_tag ? `${p.role_tag.toLowerCase()}: ${name}` : name;
    })
    .join('\n');
  return [
    'Name this fashion look in 2 to 4 words. No quotes, no punctuation, no explanation — just the name itself.',
    'Style guidance: evocative, brand-magazine voice. Avoid generic words like "Look" / "Outfit". Mix nouns and adjectives.',
    '',
    `Style preset: ${ctx.style ?? 'unspecified'}`,
    ctx.age_label ? `Age range: ${ctx.age_label}` : '',
    'Products:',
    productLines || '(no products listed)',
    '',
    'Name:',
  ].filter(Boolean).join('\n');
}

async function callClaude(prompt: string): Promise<{ name: string | null; inputTokens: number | null; outputTokens: number | null }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.error('[name-look] ANTHROPIC_API_KEY not configured');
    return { name: null, inputTokens: null, outputTokens: null };
  }
  try {
    const res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 24,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      console.error('[name-look] Claude responded', res.status, await res.text());
      return { name: null, inputTokens: null, outputTokens: null };
    }
    const data = await res.json() as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
    const text = data.content?.find(c => c.type === 'text')?.text?.trim();
    const inputTokens = data.usage?.input_tokens ?? null;
    const outputTokens = data.usage?.output_tokens ?? null;
    if (!text) return { name: null, inputTokens, outputTokens };
    // Cap at 40 chars and strip stray quotes / trailing punctuation just in case.
    const cleaned = text.replace(/^["'`]+|["'`]+$/g, '').replace(/[.!?,;:]+$/g, '').slice(0, 40);
    return { name: cleaned || null, inputTokens, outputTokens };
  } catch (err) {
    console.error('[name-look] fetch threw', err);
    return { name: null, inputTokens: null, outputTokens: null };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonRes({ success: false, error: 'Method not allowed' }, 405);
  }

  let payload: { generation_id?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonRes({ success: false, error: 'Invalid JSON' }, 400);
  }
  const generationId = payload.generation_id;
  if (!generationId || typeof generationId !== 'string') {
    return jsonRes({ success: false, error: 'generation_id required' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const client = createClient(supabaseUrl, serviceRoleKey);

  // Pull the generation + its products in one round-trip via the join table.
  const { data: gen, error: genErr } = await client
    .from('user_generations')
    .select('id, style, age_label, height_cm, display_name')
    .eq('id', generationId)
    .maybeSingle();
  if (genErr || !gen) {
    return jsonRes({ success: false, error: genErr?.message || 'Generation not found' }, 404);
  }
  if (gen.display_name) {
    // Already named — don't waste a Claude call.
    return jsonRes({ success: true, name: gen.display_name, cached: true });
  }

  const { data: products } = await client
    .from('user_generation_products')
    .select('role_tag, products(name, brand)')
    .eq('generation_id', generationId)
    .order('sort_order');

  const ctx: LookContext = {
    style: gen.style ?? null,
    age_label: gen.age_label ?? null,
    height_cm: gen.height_cm ?? null,
    products: (products ?? []).map((row: { role_tag: string | null; products?: { name?: string | null; brand?: string | null } }) => ({
      name: row.products?.name ?? null,
      brand: row.products?.brand ?? null,
      role_tag: row.role_tag ?? null,
    })),
  };

  const prompt = buildPrompt(ctx);
  const { name, inputTokens, outputTokens } = await callClaude(prompt);
  logAiUsage({
    platform: 'anthropic',
    operation: 'name-look',
    model: ANTHROPIC_MODEL,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    status: name ? 'success' : 'error',
    error_message: name ? null : 'Claude returned no name',
    metadata: { generation_id: generationId },
  });
  if (!name) {
    // Naming is decorative — never 4xx the client. Leave display_name null
    // so the LookCard falls back to the style preset, and return 200.
    console.warn('[name-look] Claude returned no name for', generationId);
    return jsonRes({ success: true, name: null, skipped: true });
  }

  const { error: updErr } = await client
    .from('user_generations')
    .update({ display_name: name })
    .eq('id', generationId);
  if (updErr) {
    return jsonRes({ success: false, error: updErr.message }, 500);
  }

  return jsonRes({ success: true, name });
});
