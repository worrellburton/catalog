// equity-advisor — Claude as the founder's fundraise/cap-table advisor.
//
// The Equity page sends the full equity state (holders, SAFEs, priced
// rounds), the computed stage summaries, and the live model assumptions;
// the admin chats with it ("should I raise more at seed?", "what does a
// 10% pool at A do to me?"). The advisor answers with concrete numbers
// and — when its advice implies a concrete restructure — returns a
// complete updated equity state the client can APPLY in one tap.
//
// Auth: caller must be a signed-in admin (profiles.is_admin).
// Secrets: ANTHROPIC_API_KEY.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MODEL = 'claude-sonnet-4-6';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const SYSTEM = `You are Catalog's fundraise advisor — a seasoned startup CFO who has priced and closed hundreds of early-stage rounds (SAFEs, priced equity, option pools, secondaries). You are advising the founder of Catalog (an AI shopping app) directly inside their cap-table tool.

You will receive:
- EQUITY STATE: the editable state — holders (founders/advisory/pools, share counts), SAFE notes (investment, val cap, discount), priced rounds (name, pre-money, named investor checks, pool top-up % of post). safeMode is 'postMoney' (YC standard) or 'sheet' (a simplified spreadsheet convention).
- COMPUTED: the tool's own math per stage (price/share, post-money, founders %, group ownership) — trust these numbers over re-deriving them.
- MODEL: the company's live financial-model assumptions (acquisition, engagement, revenue, economics), when provided.

How to answer:
- Be direct and numerate. Cite the actual numbers (ownership %, $/share, post-money). Benchmark against current market norms when relevant. Flag risks (excess dilution, tiny pools, cap/discount interactions, signaling).
- HARD LIMIT: keep the reply under 200 words — your strongest points only, as a tight list. You are generating inside a strict time budget; long answers get cut off and fail.
- When your advice implies a concrete change to the plan (round size, valuation, pool top-up, adding/removing a round or SAFE), include a complete updated equity state as "proposal". Otherwise set "proposal" to null.
- A proposal must be the FULL state in exactly the input schema (same field names; keep existing ids for rows you keep; short random strings for new ids; safeMode unchanged unless asked). Change only what your advice requires. Emit it as compact JSON — no whitespace.

Output ONLY JSON, no prose outside it:
{"reply":"<your answer — plain text, no markdown headers>","proposal":null}`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ success: false, error: 'method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ success: false, error: 'server misconfigured' }, 500);
  if (!apiKey) return json({ success: false, error: 'ANTHROPIC_API_KEY not set' }, 500);
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return json({ success: false, error: 'invalid auth' }, 401);
    const { data: prof } = await supabase.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
    if (!prof?.is_admin) return json({ success: false, error: 'admin only' }, 403);

    const body = await req.json().catch(() => ({}));
    const turns = (Array.isArray(body.messages) ? body.messages : [])
      .slice(-16)
      .map((m: { role?: string; content?: string }) => ({
        role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
        content: String(m.content ?? '').slice(0, 4000),
      }))
      .filter((m: { content: string }) => m.content.length > 0);
    if (turns.length === 0) return json({ success: false, error: 'missing messages' }, 400);

    const context = `EQUITY STATE:
${JSON.stringify(body.equity ?? {}).slice(0, 14000)}

COMPUTED (per stage, from the tool):
${JSON.stringify(body.computed ?? {}).slice(0, 6000)}

MODEL ASSUMPTIONS:
${JSON.stringify(body.model ?? {}).slice(0, 4000)}`;

    const messages = [
      { role: 'user' as const, content: context },
      { role: 'assistant' as const, content: 'Understood — I have the cap table, the computed stages and the model. What would you like to look at?' },
      ...turns,
    ];

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      // 1700 output tokens keeps generation safely inside the edge
      // runtime's ~60s upstream window (3000 ran the Kaizen audit into
      // the wall — 63s, dead, "halp").
      body: JSON.stringify({ model: MODEL, max_tokens: 1700, system: SYSTEM, messages }),
    });
    if (!res.ok) return json({ success: false, error: `anthropic ${res.status}: ${(await res.text()).slice(0, 200)}` }, 502);
    const out = await res.json() as { content?: Array<{ type: string; text?: string }> };
    const text = (out.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return json({ success: false, error: 'no JSON in completion' }, 502);
    const parsed = JSON.parse(match[0]) as { reply?: string; proposal?: unknown };
    return json({ success: true, reply: String(parsed.reply ?? '').slice(0, 8000), proposal: parsed.proposal ?? null });
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
