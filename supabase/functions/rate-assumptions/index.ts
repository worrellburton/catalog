// Rates the financial model's assumptions. Sends the model (assumptions +
// results) to Claude (Opus 4.8) and Gemini in parallel and returns each
// critique. Powers the "Rate my assumptions" modal on /admin/model.
//
// Supabase secrets used:
//   ANTHROPIC_API_KEY  — Claude (required for the Claude column)
//   GOOGLE_API_KEY     — Gemini (required for the Gemini column;
//                        GEMINI_API_KEY also accepted)
// Each provider degrades independently — a missing key / error just
// returns an `error` string for that column.

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

const SYSTEM = `You are a sharp, skeptical seed-stage investor and financial analyst reviewing a consumer-marketplace startup's 16-month financial model (a fashion shopping app that earns affiliate commission).

Review the assumptions and the results. For each KEY assumption, say in one line whether it is realistic, optimistic, or conservative, and give a realistic benchmark range. Then flag any internal inconsistencies or numbers that would make an investor skeptical (e.g. CAC payback under a month, LTV:CAC far above ~5x, conversion or retention that's too rosy, organic growth that compounds implausibly). Finish with "Top 3 changes" — the specific edits that would most improve credibility, with concrete numbers.

Be direct and concrete. Use short markdown bullets. Keep the whole reply under ~300 words. Do not restate the raw numbers back; analyze them.`;

function buildPrompt(model: unknown): string {
  return `Here is the model as JSON:\n\n${JSON.stringify(model, null, 2)}\n\nCritique these assumptions and their realism.`;
}

async function askClaude(model: unknown, apiKey: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: 1400,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(model) }],
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error?.message || `Claude HTTP ${res.status}`);
  const text = (j.content || []).map((b: { text?: string }) => b.text || '').join('').trim();
  if (!text) throw new Error('Claude returned no text');
  return text;
}

async function askGemini(model: unknown, apiKey: string): Promise<{ text: string; model: string }> {
  const candidates = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'];
  let lastErr = 'Gemini unavailable';
  for (const m of candidates) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: buildPrompt(model) }] }],
          generationConfig: { maxOutputTokens: 1400, temperature: 0.7 },
        }),
      });
      const j = await res.json();
      if (!res.ok) { lastErr = j?.error?.message || `Gemini HTTP ${res.status}`; continue; }
      const text = (j.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || '').join('').trim();
      if (text) return { text, model: m };
      lastErr = 'Gemini returned no text';
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(lastErr);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonRes({ error: 'POST only' }, 405);

  let model: unknown;
  try {
    const body = await req.json();
    model = body?.model ?? body;
  } catch {
    return jsonRes({ error: 'Invalid JSON body' }, 400);
  }

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  const googleKey = Deno.env.get('GOOGLE_API_KEY') || Deno.env.get('GEMINI_API_KEY');

  const [claudeR, geminiR] = await Promise.allSettled([
    anthropicKey ? askClaude(model, anthropicKey) : Promise.reject(new Error('ANTHROPIC_API_KEY not set')),
    googleKey ? askGemini(model, googleKey) : Promise.reject(new Error('GOOGLE_API_KEY not set')),
  ]);

  return jsonRes({
    claude: claudeR.status === 'fulfilled'
      ? { text: claudeR.value, model: 'claude-opus-4-8' }
      : { error: claudeR.reason instanceof Error ? claudeR.reason.message : String(claudeR.reason) },
    gemini: geminiR.status === 'fulfilled'
      ? { text: geminiR.value.text, model: geminiR.value.model }
      : { error: geminiR.reason instanceof Error ? geminiR.reason.message : String(geminiR.reason) },
  });
});
