// Brainstorms specific product search queries for a given catalog/vibe.
// Used by the admin "Suggest Products" modal: Claude turns a fuzzy catalog
// name ("beach day", "quiet luxury") into concrete queries that can then be
// fed to Google Shopping via the `product-search` function.
//
// Required Supabase secret (optional — falls back to heuristic queries):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx

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
  error?: { message?: string };
}

async function brainstormWithClaude(catalog: string, count: number, apiKey: string): Promise<string[]> {
  const prompt = `You are a creative merchandiser building a shoppable fashion catalog.
The catalog is titled: "${catalog}".

STEP 1 — Interpret the catalog name.
In 1–2 sentences, figure out what this catalog is really about: the vibe,
the wearer, the occasion, the aesthetic. "omg shoes" isn't 8 products
with "omg shoes" in the name — it's a curated shoe drop (statement heels,
cult sneakers, viral-worthy footwear). "quiet luxury" is neutral cashmere,
Margiela Tabis, The Row bags. "beach day" is swim, raffia bags, flip flops,
oversized linen, straw hats.

STEP 2 — Pick ${count} hero products.
Brainstorm ${count} specific Google Shopping queries that would return
real, purchasable products matching that vibe. Rules:
  • Be specific — "studded combat boots" beats "cool shoes".
  • Mix categories naturally (apparel, footwear, bags, accessories, jewelry,
    eyewear) UNLESS the catalog is category-specific (e.g. "omg shoes" →
    all shoes, "sunglasses summer" → all eyewear).
  • Include gender only when it matters ("men's swim trunks", "women's
    slip dress"). Default unisex where possible.
  • Favor queries that return clean product photography over vague
    trend searches.
  • Don't repeat the catalog name in every query — that's lazy.

Return ONLY a JSON array of ${count} query strings. No prose, no code
fences, no keys. Example:
["Margiela Tabi Mary Janes","Salomon XT-6 black","Alaïa mesh ballet flats"]`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
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

  // Strip optional code fences and find the JSON array in the response.
  const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error(`No JSON array in Claude response: ${cleaned.slice(0, 200)}`);
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('Parsed value is not an array');
  return parsed.map(String).map(s => s.trim()).filter(Boolean).slice(0, count);
}

// Deterministic fallback used when ANTHROPIC_API_KEY isn't configured or the
// Claude call fails. Not as good as Claude, but keeps the feature usable.
function heuristicQueries(catalog: string, count: number): string[] {
  const c = catalog.trim().toLowerCase();
  const base = [
    `${c} outfit`,
    `women's ${c} dress`,
    `men's ${c} shirt`,
    `${c} shoes`,
    `${c} bag`,
    `${c} sunglasses`,
    `${c} accessories`,
    `${c} jewelry`,
    `${c} jacket`,
    `${c} hat`,
    `${c} pants`,
    `${c} sandals`,
  ];
  return base.slice(0, count);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const catalog = String(body.catalog || '').trim();
    const count = Math.max(1, Math.min(20, Number(body.count) || 8));

    if (!catalog) return jsonRes({ success: false, error: 'missing catalog' }, 400);

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
    if (!apiKey) {
      // Degrade gracefully instead of 500ing — the client can still search.
      return jsonRes({
        success: true,
        queries: heuristicQueries(catalog, count),
        source: 'heuristic',
        warning: 'ANTHROPIC_API_KEY not configured — using heuristic queries',
      });
    }

    try {
      const queries = await brainstormWithClaude(catalog, count, apiKey);
      if (queries.length === 0) throw new Error('Claude returned empty list');
      return jsonRes({ success: true, queries, source: 'claude' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonRes({
        success: true,
        queries: heuristicQueries(catalog, count),
        source: 'heuristic',
        warning: `Claude failed (${msg}) — using heuristic queries`,
      });
    }
  } catch (err) {
    return jsonRes(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
