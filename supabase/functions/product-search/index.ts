// Proxies Google Shopping search via SerpAPI.
// Keeps the SERPAPI_KEY secret server-side and forwards normalized results
// to the admin "Add Products" research modal.
//
// Required Supabase secret:
//   supabase secrets set SERPAPI_KEY=xxxxxxxxxxxx

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
  const known = [
    'Nike', 'Adidas', 'Jordan', 'Puma', 'Reebok', 'New Balance', 'Converse',
    'Vans', 'On Running', 'Hoka', 'Asics', 'Levi\'s', 'Uniqlo', 'Everlane',
    'Ray-Ban', 'Oakley', 'Oliver Peoples', 'Warby Parker', 'Persol',
    'Gucci', 'Prada', 'Louis Vuitton', 'Chanel', 'Hermès', 'Dior', 'Balenciaga',
    'Zara', 'H&M', 'Reformation', 'Skims', 'AGOLDE', 'The Row', 'Coach',
    'Mulberry', 'Saint Laurent', 'Bottega Veneta', 'Rolex', 'Cartier',
    'Omega', 'TAG Heuer', 'Apple', 'Samsung',
  ];
  for (const b of known) {
    if (title.toLowerCase().includes(b.toLowerCase())) return b;
  }
  if (source) {
    const bare = source.replace(/\.(com|shop|store|net|co|io)$/i, '').replace(/-/g, ' ');
    return bare.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  return '';
}

// Fetch full gallery via SerpAPI's google_immersive_product engine using the
// page_token returned with each google_shopping result. Google's older
// google_product engine has been deprecated.
async function fetchImmersiveMedia(pageToken: string, apiKey: string): Promise<string[]> {
  try {
    const params = new URLSearchParams({
      engine: 'google_immersive_product',
      page_token: pageToken,
      api_key: apiKey,
    });
    const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
    if (!res.ok) return [];
    const json = await res.json();
    const thumbs = json?.product_results?.thumbnails;
    if (!Array.isArray(thumbs)) return [];
    return thumbs.filter((u: unknown) => typeof u === 'string' && (u as string).startsWith('http'));
  } catch {
    return [];
  }
}

async function searchSerpApi(query: string, apiKey: string, detailLimit: number): Promise<NormalizedProduct[]> {
  const params = new URLSearchParams({
    engine: 'google_shopping',
    q: query,
    api_key: apiKey,
    num: '20',
    gl: 'us',
    hl: 'en',
  });
  const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
  if (!res.ok) throw new Error(`SerpAPI ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const results = Array.isArray(json.shopping_results) ? json.shopping_results : [];
  const trimmed = results.slice(0, 20);

  // Hydrate top N results with the immersive product gallery in parallel.
  const detailTargets = trimmed
    .slice(0, detailLimit)
    .map((r: Record<string, unknown>, i: number) => ({ i, token: String(r.immersive_product_page_token || '') }))
    .filter((x: { token: string }) => x.token);

  const detailMap = new Map<number, string[]>();
  const detailResults = await Promise.all(
    detailTargets.map(async (t: { i: number; token: string }) => ({
      i: t.i,
      media: await fetchImmersiveMedia(t.token, apiKey),
    }))
  );
  for (const d of detailResults) detailMap.set(d.i, d.media);

  return trimmed.map((r: Record<string, unknown>, i: number) => {
    const title = String(r.title || '');
    const source = String(r.source || '');
    const thumbnail = String(r.thumbnail || '');
    const thumbPlural = Array.isArray(r.thumbnails) ? (r.thumbnails as string[]) : [];
    const extractedImages = Array.isArray(r.extracted_images) ? (r.extracted_images as string[]) : [];
    const gallery = detailMap.get(i) || [];
    const seen = new Set<string>();
    const images: string[] = [];
    for (const u of [thumbnail, ...thumbPlural, ...extractedImages, ...gallery]) {
      if (u && !seen.has(u)) { seen.add(u); images.push(u); }
    }
    return {
      name: title,
      brand: guessBrand(title, source),
      price: String(r.price || r.extracted_price || ''),
      image_url: images[0] || thumbnail,
      image_urls: images,
      url: String(r.product_link || r.link || ''),
      gender: inferGender(title),
      source,
    } as NormalizedProduct;
  }).filter((p: NormalizedProduct) => p.image_url && p.name);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  try {
    const url = new URL(req.url);
    let query = url.searchParams.get('q') || '';
    if (!query && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      query = String(body.query || body.q || '');
    }
    query = query.trim();
    if (!query) return jsonRes({ success: false, error: 'missing query' }, 400);

    const serpKey = Deno.env.get('SERPAPI_KEY') || '';
    if (!serpKey) return jsonRes({ success: false, error: 'SERPAPI_KEY not configured' }, 500);

    const rawLimit = url.searchParams.get('detailLimit');
    let detailLimit = rawLimit ? parseInt(rawLimit, 10) : 20;
    if (detailLimit < 0) detailLimit = 0;
    if (detailLimit > 20) detailLimit = 20;

    const products = await searchSerpApi(query, serpKey, detailLimit);
    return jsonRes({ success: true, query, count: products.length, detailLimit, products });
  } catch (err) {
    return jsonRes({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
