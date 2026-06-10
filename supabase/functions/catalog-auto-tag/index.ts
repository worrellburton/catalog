import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProductInput {
  id: string;
  name: string;
  brand: string;
  image_url?: string | null;
}

interface Body {
  products: ProductInput[];
  catalogs: string[];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const { products, catalogs } = (await req.json()) as Body;

    if (!Array.isArray(products) || !Array.isArray(catalogs) || catalogs.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing products or catalogs' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      );
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'ANTHROPIC_API_KEY not configured' }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      );
    }

    // Batch products into a single LLM call for efficiency. Claude can tag
    // ~50 products per request comfortably; cap at 30 per batch for safety.
    const BATCH_SIZE = 30;
    const results: Record<string, string[]> = {};

    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE);

      const productList = batch
        .map((p, j) => `${j + 1}. [id=${p.id}] ${p.brand} — ${p.name}`)
        .join('\n');
      const catalogList = catalogs.map((c, i) => `${i + 1}. "${c}"`).join('\n');

      const prompt = `You are tagging fashion/lifestyle products with relevant catalog vibes.\n\nCATALOGS (the vibes/moods/categories to match against):\n${catalogList}\n\nPRODUCTS:\n${productList}\n\nFor each product, return which catalogs apply. Multiple catalogs can apply to one product. Be generous but not sloppy — only include catalogs that genuinely fit the product's vibe/use case.\n\nReturn JSON only, no other text, in this exact shape:\n{\n  "results": [\n    { "id": "<product id>", "catalogs": ["catalog name", "another catalog"] }\n  ]\n}`;

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          // Haiku handles this catalog-vibe classification well and is much
          // faster (and cheaper) than Sonnet, which matters because the
          // admin auto-pick fans out many of these calls in parallel.
          model: 'claude-haiku-4-5',
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error('Anthropic error:', resp.status, errText);
        continue;
      }

      const json = await resp.json();
      const text: string = json?.content?.[0]?.text ?? '';

      // Extract JSON from the response (tolerate any prose wrapping)
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) continue;

      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed.results)) {
          for (const r of parsed.results) {
            if (r.id && Array.isArray(r.catalogs)) {
              results[r.id] = r.catalogs.filter((c: unknown) => typeof c === 'string');
            }
          }
        }
      } catch (e) {
        console.warn('JSON parse failed for batch', i);
      }
    }

    return new Response(
      JSON.stringify({ success: true, tagged: Object.keys(results).length, results }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }
});
