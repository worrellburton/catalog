import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

// catalog-recommend-looks
//
// Claude picks which of the EXISTING library looks best fit a given
// catalog (by name/vibe), ranks them, and returns the chosen look ids
// with a one-line reason each. This is the read-side counterpart to
// catalog-assemble-look (which generates a brand-new look) — here we
// curate from what already exists so the admin can one-click attach
// the best matches.
//
// POST { catalog: string, looks: {id,title,creator,products?}[], count? }
//  -> { success, recommendations: { id, reason }[], error? }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LookIn {
  id: string;
  title?: string | null;
  creator?: string | null;
  gender?: string | null;
  products?: string[] | null;
}

interface Body {
  catalog: string;
  looks: LookIn[];
  count?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  try {
    const { catalog, looks, count = 8 } = (await req.json()) as Body;
    if (!catalog || !Array.isArray(looks) || looks.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Missing catalog or looks' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ success: false, error: 'ANTHROPIC_API_KEY not configured' }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const lookList = looks
      .map(l => {
        const prods = Array.isArray(l.products) && l.products.length
          ? ` | features: ${l.products.slice(0, 6).join(', ')}`
          : '';
        const g = l.gender ? ` | ${l.gender}` : '';
        return `[id=${l.id}] "${l.title || 'Untitled'}"${l.creator ? ` by ${l.creator}` : ''}${g}${prods}`;
      })
      .join('\n');

    const prompt = `You are a fashion merchandiser curating a catalog called "${catalog}".\n\nBelow is the library of available looks (short fashion videos). Pick the ${count} looks that BEST fit the "${catalog}" catalog's vibe/theme. Consider the catalog name's connotations (season, aesthetic, gender, occasion) and each look's title, creator, and featured products.\n\nAvailable looks:\n${lookList}\n\nReturn JSON only, no prose, no markdown. Order best-fit first. Each reason is max 80 chars explaining why it fits "${catalog}":\n{\n  "recommendations": [\n    { "id": "uuid", "reason": "..." }\n  ]\n}\n\nOnly include looks that genuinely fit. If fewer than ${count} fit well, return fewer. Never invent ids — only use ids from the list above.`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return new Response(JSON.stringify({ success: false, error: `Anthropic: ${resp.status} ${errText}` }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const json = await resp.json();
    const text: string = json?.content?.[0]?.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return new Response(JSON.stringify({ success: false, error: 'No JSON in response', raw: text }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const parsed = JSON.parse(match[0]);
    const validIds = new Set(looks.map(l => l.id));
    const recommendations: { id: string; reason: string }[] = Array.isArray(parsed.recommendations)
      ? parsed.recommendations
          .filter((r: unknown): r is { id: string; reason?: string } =>
            !!r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string' && validIds.has((r as { id: string }).id))
          .map((r: { id: string; reason?: string }) => ({ id: r.id, reason: typeof r.reason === 'string' ? r.reason.slice(0, 120) : '' }))
      : [];

    return new Response(JSON.stringify({ success: true, catalog, recommendations }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
});
