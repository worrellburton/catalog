// catalog-suggest — at the end of the search ceremony, turn a plain query +
// the shopper's demographics into 2-3 SHORT, fun, specific catalog names that
// are more interesting than the raw term (e.g. "hair" → "Wash-day heroes",
// "Slept-on scalp care", "Salon-at-home"). Returns just the names; the client
// runs whichever the shopper taps (or lets them continue with the raw query).
//
// Public (verify_jwt:false): generates catalog-name STRINGS only — no DB reads
// or writes, no sensitive data — and search itself is available to guests.

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonRes({ catalogs: [] }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  let body: { term?: string; gender?: string; age?: string };
  try { body = await req.json(); } catch { return jsonRes({ catalogs: [] }, 400); }
  const term = String(body.term ?? '').trim().slice(0, 80);
  const gender = String(body.gender ?? '').trim().toLowerCase();
  const age = String(body.age ?? '').trim().slice(0, 40);
  if (!term) return jsonRes({ catalogs: [] });
  // No key configured → return empty so the client just reveals the raw results.
  if (!apiKey) return jsonRes({ catalogs: [] });

  const who = [
    gender && gender !== 'all' ? `gender: ${gender}` : '',
    age ? `age: ${age}` : '',
  ].filter(Boolean).join(', ') || 'unspecified';

  const prompt = `A shopper searched "${term}" in a fashion/shopping app. Their demographics — ${who}.

Turn that plain search into 2-3 SHORT, fun, specific CATALOG names that are far more interesting than the raw term, tailored to who they are. Think editorial drop titles, not categories. Each should make them go "ooh, that one".

Rules:
- 2 or 3 names. Each ≤ 26 characters. Title case-ish, no quotes, no trailing punctuation.
- Make them feel curated and specific to the term + demographics, not generic.
- Don't just restate the term. "hair" should NOT yield "Hair" — yield things like "Wash-Day Heroes" or "Slept-On Scalp Care".

Return ONLY a JSON array of the 2-3 strings. No prose, no code fences. Example for "shorts" (female, 20s): ["Off-Duty Shorts","Tailored & Tiny","Linen Season"]`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return jsonRes({ catalogs: [] });
    const json = await res.json() as { content?: Array<{ type: string; text?: string }> };
    const text = json.content?.find(c => c.type === 'text')?.text?.trim() ?? '';
    const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
    const start = cleaned.indexOf('['); const end = cleaned.lastIndexOf(']');
    if (start < 0 || end <= start) return jsonRes({ catalogs: [] });
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(parsed)) return jsonRes({ catalogs: [] });
    const catalogs = parsed
      .map(String)
      .map(s => s.trim().replace(/^["']|["'.]+$/g, '').trim())
      .filter(Boolean)
      .filter(s => s.length <= 32)
      .slice(0, 3);
    return jsonRes({ catalogs });
  } catch {
    return jsonRes({ catalogs: [] });
  }
});
