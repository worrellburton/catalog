// Generates (and caches) a short, flattering "about" blurb for a creator,
// shown on the look overlay's About tab. Claude reads the creator's look
// titles + the brands/categories they feature and writes 1-2 sentences on
// their aesthetic. Cached in creator_about_summaries keyed by handle so we
// only call the model once per creator (until their catalog grows stale).
//
// Required Supabase secret (optional — falls back to a heuristic blurb):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logAiUsage } from '../_shared/ai-usage.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

// Re-generate at most this often, even as the catalog grows.
const FRESH_DAYS = 30;
const MODEL = 'claude-sonnet-4-6';

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface LookInput {
  title?: string | null;
  brands?: string[] | null;
  types?: string[] | null;
}

interface ClaudeResponse {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function topN(values: string[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const v = (raw || '').trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]).slice(0, n);
}

function buildFacts(displayName: string, looks: LookInput[]) {
  const titles = looks.map(l => (l.title || '').trim()).filter(Boolean).slice(0, 12);
  const brands = topN(looks.flatMap(l => l.brands || []), 8);
  const types = topN(looks.flatMap(l => l.types || []), 8);
  return { titles, brands, types, lookCount: looks.length };
}

// Plain-language fallback when Claude isn't available — still useful.
function heuristicSummary(displayName: string, looks: LookInput[]): string {
  const { brands, types, lookCount } = buildFacts(displayName, looks);
  const who = displayName || 'This creator';
  const parts: string[] = [];
  if (types.length) parts.push(types.slice(0, 3).join(', '));
  if (brands.length) parts.push(`featuring ${brands.slice(0, 3).join(', ')}`);
  if (!parts.length) return `${who} is building out their catalog — check back soon.`;
  return `${who} curates ${lookCount} look${lookCount === 1 ? '' : 's'} leaning into ${parts.join(', ')}.`;
}

async function summarizeWithClaude(displayName: string, looks: LookInput[], apiKey: string) {
  const { titles, brands, types, lookCount } = buildFacts(displayName, looks);
  const prompt = `You write short, tasteful creator bios for a fashion lookbook app.

Creator: ${displayName || 'Unknown'}
Number of looks: ${lookCount}
Look titles: ${titles.length ? titles.join('; ') : '(none)'}
Brands they feature: ${brands.length ? brands.join(', ') : '(unknown)'}
Categories: ${types.length ? types.join(', ') : '(unknown)'}

Write 1-2 sentences (max ~40 words) describing this creator's aesthetic and
what a shopper following them can expect. Be specific and warm, never
generic or salesy. Do not use the words "fashionista", "curate/curated",
"elevate", or "effortless". Do not start with the creator's name. Return
ONLY the sentence(s) — no quotes, no preamble.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as ClaudeResponse;
  const text = json.content?.find(c => c.type === 'text')?.text?.trim() ?? '';
  if (!text) throw new Error('Claude returned no text');
  return {
    summary: text.replace(/^["']|["']$/g, '').trim(),
    inputTokens: json.usage?.input_tokens ?? null,
    outputTokens: json.usage?.output_tokens ?? null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const db = createClient(supabaseUrl, serviceRoleKey);

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const handle = String(body.handle || '').trim();
    const displayName = String(body.displayName || '').trim();
    const looks: LookInput[] = Array.isArray(body.looks) ? body.looks.slice(0, 40) : [];
    const force = body.force === true;

    if (!handle) return jsonRes({ success: false, error: 'missing handle' }, 400);

    // Serve a fresh cached blurb without hitting Claude.
    if (!force) {
      const { data: cached } = await db
        .from('creator_about_summaries')
        .select('summary, generated_at')
        .eq('handle', handle)
        .maybeSingle();
      if (cached?.summary) {
        const ageDays = (Date.now() - Date.parse(cached.generated_at)) / 86_400_000;
        if (ageDays < FRESH_DAYS) {
          return jsonRes({ success: true, summary: cached.summary, source: 'cache' });
        }
      }
    }

    if (looks.length === 0) {
      return jsonRes({ success: false, error: 'no looks to summarize' }, 422);
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
    let summary: string;
    let source: string;
    if (!apiKey) {
      summary = heuristicSummary(displayName, looks);
      source = 'heuristic';
    } else {
      try {
        const out = await summarizeWithClaude(displayName, looks, apiKey);
        summary = out.summary;
        source = 'claude';
        logAiUsage({
          platform: 'anthropic',
          operation: 'creator-about',
          model: MODEL,
          input_tokens: out.inputTokens,
          output_tokens: out.outputTokens,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logAiUsage({
          platform: 'anthropic',
          operation: 'creator-about',
          model: MODEL,
          status: 'error',
          error_message: msg.slice(0, 500),
        });
        summary = heuristicSummary(displayName, looks);
        source = 'heuristic';
      }
    }

    await db
      .from('creator_about_summaries')
      .upsert({ handle, summary, generated_at: new Date().toISOString() }, { onConflict: 'handle' });

    return jsonRes({ success: true, summary, source });
  } catch (err) {
    return jsonRes({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
