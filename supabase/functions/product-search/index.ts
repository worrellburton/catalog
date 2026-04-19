// Proxies Google Shopping search via SerpAPI.
// Keeps the SERPAPI_KEY secret server-side and forwards normalized results
// to the admin "Add Products" research modal.
//
// Required Supabase secret:
//   supabase secrets set SERPAPI_KEY=xxxxxxxxxxxx
//
// Optional: BING_SEARCH_KEY (fallback) — not used unless added.

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

interface NormalizedProduct {
  name: string;
  brand: string;
  price: string;
  image_url: string;
  image_urls: string[];
  url: string;
  gender: 'men' | 'women' | 'unisex';
  source: string;
}

function inferGender(text: string): 'men' | 'women' | 'unisex' {
  const t = text.toLowerCase();
  if (/\b(women|woman|womens|ladies|female|girls?)\b/.test(t)) return 'women';
  if (/\b(men|man|mens|male|boys?)\b/.test(t)) return 'men';
  return 'unisex';
}

function guessBrand(title: string, source: string): string {
  const knownBrands = [
    'Nike', 'Adidas', 'Jordan', 'Puma', 'Reebok', 'New Balance', 'Converse',
    'Vans', 'On Running', 'Hoka', 'Asics', 'Levi\'s', 'Uniqlo', 'Everlane',
    'Ray-Ban', 'Oakley', 'Oliver Peoples', 'Warby Parker', 'Persol',
    'Gucci', 'Prada', 'Louis Vuitton', 'Chanel', 'Hermès', 'Dior', 'Balenciaga',
    'Zara', 'H&M', 'Reformation', 'Skims', 'AGOLDE', 'The Row', 'Coach',
    'Mulberry', 'Saint Laurent', 'Bottega Veneta', 'Rolex', 'Cartier',
    'Omega', 'TAG Heuer', 'Apple', 'Samsung',
  ];
  for (const b of knownBrands) {
    if (title.toLowerCase().includes(b.toLowerCase())) return b;
  }
  // Fall back to the source/store domain
  if (source) {
    const bare = source.replace(/\.(com|shop|store|net|co|io)$/i, '').replace(/-/g, ' ');
    return bare
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  return '';
}

async function searchSerpApi(query: string, apiKey: string): Promise<NormalizedProduct[]> {
  const params = new URLSearchParams({
    engine: 'google_shopping',
    q: query,
    api_key: apiKey,
    num: '20',
    gl: 'us',
    hl: 'en',
  });
  const url = `https://serpapi.com/search.json?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`SerpAPI ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  const results = Array.isArray(json.shopping_results) ? json.shopping_results : [];

  return results.slice(0, 20).map((r: Record<string, unknown>) => {
    const title = String(r.title || '');
    const source = String(r.source || '');
    const thumbnail = String(r.thumbnail || '');
    const extra = Array.isArray(r.extracted_images) ? (r.extracted_images as string[]) : [];
    const images = [thumbnail, ...extra].filter(Boolean);
    const price = String(r.price || r.extracted_price || '');
    const productUrl = String(r.product_link || r.link || '');
    const brand = guessBrand(title, source);

    return {
      name: title,
      brand,
      price,
      image_url: thumbnail,
      image_urls: images,
      url: productUrl,
      gender: inferGender(title),
      source,
    } as NormalizedProduct;
  }).filter((p: NormalizedProduct) => p.image_url && p.name);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const url = new URL(req.url);
    let query = url.searchParams.get('q') || '';
    if (!query && (req.method === 'POST')) {
      const body = await req.json().catch(() => ({}));
      query = String(body.query || body.q || '');
    }
    query = query.trim();
    if (!query) return jsonRes({ success: false, error: 'missing query' }, 400);

    const serpKey = Deno.env.get('SERPAPI_KEY') || '';
    if (!serpKey) {
      return jsonRes({ success: false, error: 'SERPAPI_KEY not configured' }, 500);
    }

    const products = await searchSerpApi(query, serpKey);
    return jsonRes({ success: true, query, count: products.length, products });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ success: false, error: msg }, 500);
  }
});
