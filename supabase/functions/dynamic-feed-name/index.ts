// Names the personalized "you might also like" feed with a short, witty,
// one-off line based on what the shopper keeps engaging with. Robert's brief:
// reframe the continuous feed as a section whose title is "kind of a joke
// about what it is about" and changes every time the user sees it.
//
// Input  (POST JSON): { topTypes: string[], dominant: string }
// Output (JSON):      { success: true, name: string, source: 'claude' | 'heuristic' }
//
// Required Supabase secret (optional — falls back to a heuristic line):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx

import { logAiUsage } from '../_shared/ai-usage.ts';

const MODEL = 'claude-haiku-4-5-20251001';

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

interface ClaudeResponse {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

async function nameWithClaude(
  dominant: string,
  topTypes: string[],
  apiKey: string,
): Promise<{ name: string; inputTokens: number | null; outputTokens: number | null }> {
  const prompt = `You write playful section headers for a fashion shopping app.

A shopper keeps gravitating toward these product categories (strongest first):
${topTypes.length ? topTypes.join(', ') : dominant}.

Write ONE short, witty section title (max ~7 words) for a feed that's about to
show them more of this. It should be a light, self-aware joke about their
obsession — friendly, never mean. You may use ONE emoji, at most.

Good examples:
  "Yes, more sneakers. We get you. 👟"
  "Your bag problem, fully enabled"
  "Okay but have you seen these boots?"

Return ONLY the title text. No quotes, no prose, no JSON.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 64,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as ClaudeResponse;
  const raw = json.content?.find(c => c.type === 'text')?.text?.trim() ?? '';
  // Defensive cleanup: strip wrapping quotes / trailing punctuation noise and
  // clamp length so a runaway response can never blow out the heading.
  const name = raw.replace(/^["'`]+|["'`]+$/g, '').trim().slice(0, 60);
  if (!name) throw new Error('Claude returned no text');
  return {
    name,
    inputTokens: json.usage?.input_tokens ?? null,
    outputTokens: json.usage?.output_tokens ?? null,
  };
}

// Deterministic fallback when ANTHROPIC_API_KEY is unset or Claude fails.
function heuristicName(dominant: string): string {
  const d = (dominant || '').trim().toLowerCase();
  if (!d) return 'Picked because of your taste';
  return `Yes, more ${d}. We get you.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const dominant = String(body.dominant || '').trim();
    const topTypes = Array.isArray(body.topTypes)
      ? body.topTypes.map((t: unknown) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 6)
      : [];

    if (!dominant && topTypes.length === 0) {
      return jsonRes({ success: false, error: 'missing affinity (dominant/topTypes)' }, 400);
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
    if (!apiKey) {
      return jsonRes({
        success: true,
        name: heuristicName(dominant || topTypes[0]),
        source: 'heuristic',
        warning: 'ANTHROPIC_API_KEY not configured — using heuristic name',
      });
    }

    try {
      const { name, inputTokens, outputTokens } = await nameWithClaude(dominant || topTypes[0], topTypes, apiKey);
      logAiUsage({
        platform: 'anthropic',
        operation: 'feed-name',
        model: MODEL,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      });
      return jsonRes({ success: true, name, source: 'claude' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logAiUsage({
        platform: 'anthropic',
        operation: 'feed-name',
        model: MODEL,
        status: 'error',
        error_message: msg.slice(0, 500),
      });
      return jsonRes({
        success: true,
        name: heuristicName(dominant || topTypes[0]),
        source: 'heuristic',
        warning: `Claude failed (${msg}) — using heuristic name`,
      });
    }
  } catch (err) {
    return jsonRes(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
