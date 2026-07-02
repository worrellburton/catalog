// Proxies Google Shopping search via SerpAPI.
// Keeps the SERPAPI_KEY secret server-side and forwards normalized results
// to the admin "Add Products" research modal.
//
// When called with `{ ingest: true }`, also persists each scraped product
// into the `products` table and triggers `embed-entity` so it becomes
// searchable. Used by the search-backfill closed-loop agent.
//
// Required Supabase secrets:
//   SERPAPI_KEY                 — SerpAPI Google Shopping
//   SUPABASE_URL                — for ingest path
//   SUPABASE_SERVICE_ROLE_KEY   — for ingest path

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logAiUsage } from '../_shared/ai-usage.ts';

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

// The catalog's products.gender CHECK allows only male / female / unisex, so
// normalize SerpAPI's men/women labels (and any male/female input) before
// insert — otherwise the ingest row is rejected by products_gender_check.
function toCatalogGender(g: string): 'male' | 'female' | 'unisex' {
  const v = (g || '').toLowerCase();
  if (['men', 'man', 'mens', 'male', 'boys', 'boy'].includes(v)) return 'male';
  if (['women', 'woman', 'womens', 'female', 'ladies', 'girls', 'girl'].includes(v)) return 'female';
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
    // Activewear / athleisure
    'Lululemon', 'Alo', 'Alo Yoga', 'Vuori', 'Athleta', 'Gymshark',
    'Sweaty Betty', 'Outdoor Voices', 'Girlfriend Collective', 'Carbon38',
    'Fabletics', 'Peloton', 'Under Armour', 'Columbia', 'Patagonia', 'Arc\'teryx',
    'The North Face', 'Fjällräven', 'Stone Island', 'CP Company',
    // Contemporary / streetwear
    'Supreme', 'Off-White', 'Palm Angels', 'Amiri', 'Fear of God', 'Essentials',
    'Stüssy', 'Kith', 'Carhartt', 'Dickies', 'Polo Ralph Lauren', 'Tommy Hilfiger',
    'Calvin Klein', 'Gap', 'Banana Republic', 'J.Crew', 'Madewell',
    'Free People', 'Anthropologie', 'Urban Outfitters', 'Aritzia', 'Wilfred',
    // Footwear
    'UGG', 'Birkenstock', 'Dr. Martens', 'Timberland', 'Golden Goose', 'Salomon',
    'Clarks', 'Sperry', 'Steve Madden', 'ALDO', 'Sam Edelman',
    // Accessories / jewellery
    'Mejuri', 'Missoma', 'Monica Vinader', 'Tiffany & Co.', 'Pandora',
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

// Fetch the full gallery AND resolve the merchant URL via SerpAPI's
// google_immersive_product engine using the page_token returned with each
// google_shopping result. SerpAPI's `link` / `product_link` fields are usually
// google.com/shopping/product/... pages that the scraper agent can never turn
// into a real PDP, so we pull the top online seller's direct merchant URL out
// of the immersive details and use that instead.
interface ImmersiveDetails {
  images: string[];
  merchantUrl: string;
}

function isGoogleUrl(u: string): boolean {
  return /^https?:\/\/(www\.)?google\.com\//i.test(u);
}

async function fetchImmersiveDetails(pageToken: string, apiKey: string): Promise<ImmersiveDetails> {
  try {
    const params = new URLSearchParams({
      engine: 'google_immersive_product',
      page_token: pageToken,
      api_key: apiKey,
    });
    const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
    if (!res.ok) return { images: [], merchantUrl: '' };
    const json = await res.json();
    const thumbs = json?.product_results?.thumbnails;
    const images = Array.isArray(thumbs)
      ? thumbs.filter((u: unknown): u is string => typeof u === 'string' && u.startsWith('http'))
      : [];

    // Pick the first non-Google merchant URL from the seller list. The real
    // PDP link lives under product_results.stores[].link (verified against the
    // live immersive schema — e.g. oldnavy.gap.com/browse/product.do?pid=…).
    // The other shapes are kept for cross-version resilience.
    type Seller = { direct_link?: string; link?: string };
    const sellerLists: Seller[][] = [
      json?.product_results?.stores,
      json?.sellers_results?.online_sellers,
      json?.online_sellers,
      json?.stores,
      json?.product_results?.online_sellers,
    ].filter((x: unknown) => Array.isArray(x)) as Seller[][];

    let merchantUrl = '';
    for (const sellers of sellerLists) {
      for (const s of sellers) {
        const candidate = String(s?.direct_link || s?.link || '').trim();
        if (candidate && /^https?:\/\//i.test(candidate) && !isGoogleUrl(candidate)) {
          merchantUrl = candidate;
          break;
        }
      }
      if (merchantUrl) break;
    }

    return { images, merchantUrl };
  } catch {
    return { images: [], merchantUrl: '' };
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

  const detailMap = new Map<number, ImmersiveDetails>();
  const detailResults = await Promise.all(
    detailTargets.map(async (t: { i: number; token: string }) => ({
      i: t.i,
      details: await fetchImmersiveDetails(t.token, apiKey),
    }))
  );
  for (const d of detailResults) detailMap.set(d.i, d.details);

  return trimmed.map((r: Record<string, unknown>, i: number) => {
    const title = String(r.title || '');
    const source = String(r.source || '');
    const thumbnail = String(r.thumbnail || '');
    const thumbPlural = Array.isArray(r.thumbnails) ? (r.thumbnails as string[]) : [];
    const extractedImages = Array.isArray(r.extracted_images) ? (r.extracted_images as string[]) : [];
    const details = detailMap.get(i);
    const gallery = details?.images || [];
    const seen = new Set<string>();
    const images: string[] = [];
    for (const u of [thumbnail, ...thumbPlural, ...extractedImages, ...gallery]) {
      if (u && !seen.has(u)) { seen.add(u); images.push(u); }
    }

    // Only a real (non-Google) merchant URL counts. Google Shopping links —
    // both /shopping/product/<id> and ?ibp=oshop&q=… — are dead ends: they
    // render "Nothing to see here" for shoppers and the scraper can't resolve
    // them. Prefer the immersive stores[] PDP, else the result's own
    // product_link/link when it's a real merchant. No Google fallback.
    const resolvedUrl = [
      details?.merchantUrl || '',
      String(r.product_link || ''),
      String(r.link || ''),
    ].find(u => u && /^https?:\/\//i.test(u) && !isGoogleUrl(u)) || '';

    return {
      name: title,
      brand: guessBrand(title, source),
      price: String(r.price || r.extracted_price || ''),
      image_url: images[0] || thumbnail,
      image_urls: images,
      url: resolvedUrl,
      gender: inferGender(title),
      source,
    } as NormalizedProduct;
  }).filter((p: NormalizedProduct) =>
    // Only require name and image — URL quality is enforced at ingest time by
    // the frontend's isLikelyProductUrl check. This allows brand-name searches
    // (e.g. "lululemon") to surface products even when we can't resolve a direct
    // merchant URL from SerpAPI's immersive product data.
    p.image_url && p.name,
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  try {
    const url = new URL(req.url);
    let query = url.searchParams.get('q') || '';
    let ingest = url.searchParams.get('ingest') === 'true';
    let ingestGender: string | undefined;
    let ingestSource: string | null = null;
    let ingestActive = true;
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (!query) query = String(body.query || body.q || '');
      if (body.ingest === true) ingest = true;
      if (body.gender && ['men', 'women', 'unisex', 'male', 'female'].includes(String(body.gender).toLowerCase())) {
        ingestGender = String(body.gender).toLowerCase();
      }
      // Optional ingest provenance + visibility — the seeding orchestrator passes
      // source:'seed_serpapi' (the deletable flag) and is_active:false so the
      // quality gate, not the default, decides go-live.
      if (typeof body.source === 'string') ingestSource = body.source;
      if (typeof body.is_active === 'boolean') ingestActive = body.is_active;
    }
    query = query.trim();
    if (!query) return jsonRes({ success: false, error: 'missing query' }, 400);

    const serpKey = Deno.env.get('SERPAPI_KEY') || '';
    if (!serpKey) return jsonRes({ success: false, error: 'SERPAPI_KEY not configured' }, 500);

    const rawLimit = url.searchParams.get('detailLimit');
    // Default to 5 immersive detail lookups (was 20) to reduce SerpAPI credit
    // usage and latency. Each immersive call costs 1 credit and the merchant URL
    // hit rate drops sharply beyond the top few results.
    let detailLimit = rawLimit ? parseInt(rawLimit, 10) : 5;
    if (detailLimit < 0) detailLimit = 0;
    if (detailLimit > 20) detailLimit = 20;

    const products = await searchSerpApi(query, serpKey, detailLimit);

    // Log the SerpAPI call (1 credit for the main search + up to detailLimit
    // immersive lookups, each costing 1 credit too).
    logAiUsage({
      platform: 'serpapi',
      operation: 'product-search',
      units: 1 + Math.min(detailLimit, products.length),
      metadata: { query, result_count: products.length, detail_limit: detailLimit },
    });

    // ── Ingest path: persist + queue embeddings ─────────────────────────────
    let ingested: { id: string; name: string }[] = [];
    if (ingest && products.length) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      if (!supabaseUrl || !serviceKey) {
        return jsonRes({ success: false, error: 'ingest requested but Supabase env missing' }, 500);
      }
      const admin = createClient(supabaseUrl, serviceKey);

      // Skip products that already exist (dedupe by url)
      const urls = products.map(p => p.url).filter(Boolean);
      const { data: existing } = await admin
        .from('products')
        .select('url')
        .in('url', urls);
      const existingUrls = new Set((existing ?? []).map(r => r.url));

      // Never ingest a URL-less or Google-link row: it can't be clicked out and
      // the scraper can't enrich it. searchSerpApi already resolves the real
      // merchant PDP (immersive stores[].link) and stores '' when there isn't
      // one, so this filter just drops those — no dead ends in the catalog.
      const rowsToInsert = products
        .filter(p => p.url && !isGoogleUrl(p.url) && !existingUrls.has(p.url))
        .map(p => ({
          name: p.name,
          brand: p.brand || null,
          price: p.price || null,
          url: p.url,
          image_url: p.image_url || null,
          // Persist the full SerpAPI gallery (thumbnail + thumbnails +
          // extracted_images + immersive), not just image_url — the auto-pick
          // trigger and the ad/video generator both read products.images[].
          images: p.image_urls.length ? p.image_urls : (p.image_url ? [p.image_url] : []),
          gender: toCatalogGender(ingestGender ?? p.gender),
          source: ingestSource,
          is_active: ingestActive,
        }));

      if (rowsToInsert.length) {
        const { data: inserted, error: insertErr } = await admin
          .from('products')
          .insert(rowsToInsert)
          .select('id, name');
        if (insertErr) {
          return jsonRes({ success: false, error: `ingest insert: ${insertErr.message}` }, 500);
        }
        ingested = inserted ?? [];

        // Fire embed-product for each newly inserted product (best-effort, parallel).
        // The DB trigger trg_products_auto_embed also covers this, but calling
        // explicitly here avoids waiting on pg_net's deferred queue.
        await Promise.allSettled(
          ingested.map(row =>
            fetch(`${supabaseUrl}/functions/v1/embed-product`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${serviceKey}`,
                apikey: serviceKey,
              },
              body: JSON.stringify({ id: row.id }),
            })
          )
        );
      }
    }

    return jsonRes({
      success: true,
      query,
      count: products.length,
      detailLimit,
      products,
      ingested: ingest ? { count: ingested.length, ids: ingested.map(r => r.id) } : undefined,
    });
  } catch (err) {
    return jsonRes({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
