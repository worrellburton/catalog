// Google Lens visual-match proxy via SerpAPI.
//
// Takes an image URL (the public URL of a Style sheet image — or a
// cropped region uploaded to user-uploads) and returns normalized
// shopping matches. The caller can optionally pass a `q` text hint
// ("denim jacket", "white sneakers") which SerpAPI uses to narrow the
// visual match results.
//
// Required Supabase secrets:
//   SERPAPI_KEY                 — SerpAPI Google Lens engine (paid plan)
//
// Request body:
//   { image_url: string; q?: string; country?: string }
//
// Response:
//   { success: true, count, matches: NormalizedMatch[] }

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

interface NormalizedMatch {
  position: number;
  title: string;
  source: string;
  source_icon: string;
  link: string;
  thumbnail: string;
  image: string;
  price: string;
  brand: string;
  rating: number | null;
  reviews: number | null;
}

// Reuse the brand-guessing heuristic from product-search: SerpAPI's Lens
// response often has a clean source domain but no explicit brand field,
// so we fall back to matching the title against the curated brand list.
const KNOWN_BRANDS = [
  'Nike', 'Adidas', 'Jordan', 'Puma', 'Reebok', 'New Balance', 'Converse',
  'Vans', 'On Running', 'Hoka', 'Asics', "Levi's", 'Uniqlo', 'Everlane',
  'Ray-Ban', 'Oakley', 'Oliver Peoples', 'Warby Parker', 'Persol',
  'Gucci', 'Prada', 'Louis Vuitton', 'Chanel', 'Hermès', 'Dior', 'Balenciaga',
  'Zara', 'H&M', 'Reformation', 'Skims', 'AGOLDE', 'The Row', 'Coach',
  'Mulberry', 'Saint Laurent', 'Bottega Veneta', 'Rolex', 'Cartier',
  'Omega', 'TAG Heuer', 'Apple', 'Samsung',
  'Lululemon', 'Alo', 'Alo Yoga', 'Vuori', 'Athleta', 'Gymshark',
  'Sweaty Betty', 'Outdoor Voices', 'Girlfriend Collective', 'Carbon38',
  'Fabletics', 'Peloton', 'Under Armour', 'Columbia', 'Patagonia', "Arc'teryx",
  'The North Face', 'Fjällräven', 'Stone Island', 'CP Company',
  'Supreme', 'Off-White', 'Palm Angels', 'Amiri', 'Fear of God', 'Essentials',
  'Stüssy', 'Kith', 'Carhartt', 'Dickies', 'Polo Ralph Lauren', 'Tommy Hilfiger',
  'Calvin Klein', 'Gap', 'Banana Republic', 'J.Crew', 'Madewell',
  'Free People', 'Anthropologie', 'Urban Outfitters', 'Aritzia', 'Wilfred',
  'UGG', 'Birkenstock', 'Dr. Martens', 'Timberland', 'Golden Goose', 'Salomon',
  'Clarks', 'Sperry', 'Steve Madden', 'ALDO', 'Sam Edelman',
  'Mejuri', 'Missoma', 'Monica Vinader', 'Tiffany & Co.', 'Pandora',
];

function guessBrand(title: string, source: string): string {
  for (const b of KNOWN_BRANDS) {
    if (title.toLowerCase().includes(b.toLowerCase())) return b;
  }
  if (source) {
    const bare = source.replace(/\.(com|shop|store|net|co|io)$/i, '').replace(/-/g, ' ');
    return bare.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  return '';
}

interface SerpLensPrice {
  value?: string;
  extracted_value?: number;
  currency?: string;
}

interface SerpLensMatch {
  position?: number;
  title?: string;
  link?: string;
  source?: string;
  source_icon?: string;
  thumbnail?: string;
  image?: string;
  price?: SerpLensPrice;
  rating?: number;
  reviews?: number;
}

async function searchSerpLens(
  imageUrl: string,
  apiKey: string,
  opts: { q?: string; country: string },
): Promise<NormalizedMatch[]> {
  const params = new URLSearchParams({
    engine: 'google_lens',
    url: imageUrl,
    api_key: apiKey,
    country: opts.country,
    hl: 'en',
    // type=all gives us the widest pool of visual + exact matches.
    // We previously used type=products which collapsed to 0 results on
    // most outfit photos — the post-filter in our normaliser already
    // throws away rows missing a merchant link, so we don't need the
    // API-side restriction to keep the grid shoppable.
    type: 'all',
  });
  if (opts.q) params.set('q', opts.q);

  const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
  if (!res.ok) throw new Error(`SerpAPI ${res.status}: ${await res.text()}`);
  const json = await res.json();

  // SerpAPI returns visual_matches[] for Lens. Some products surface
  // under exact_matches[] when Lens recognizes the exact item — merge
  // both lists, exact_matches first since they're highest signal.
  const exact: SerpLensMatch[] = Array.isArray(json.exact_matches) ? json.exact_matches : [];
  const visual: SerpLensMatch[] = Array.isArray(json.visual_matches) ? json.visual_matches : [];
  const merged: SerpLensMatch[] = [...exact, ...visual];

  return merged.slice(0, 30).map((m, i): NormalizedMatch => {
    const title = String(m.title ?? '').trim();
    const source = String(m.source ?? '').trim();
    const price = m.price?.value
      ? String(m.price.value)
      : m.price?.extracted_value != null
        ? `$${m.price.extracted_value}`
        : '';
    return {
      position: m.position ?? i + 1,
      title,
      source,
      source_icon: String(m.source_icon ?? ''),
      link: String(m.link ?? ''),
      thumbnail: String(m.thumbnail ?? m.image ?? ''),
      image: String(m.image ?? m.thumbnail ?? ''),
      price,
      brand: guessBrand(title, source),
      rating: typeof m.rating === 'number' ? m.rating : null,
      reviews: typeof m.reviews === 'number' ? m.reviews : null,
    };
  }).filter(m => m.title && (m.thumbnail || m.image) && m.link);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  try {
    let imageUrl = '';
    let q = '';
    let country = 'us';
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({} as Record<string, unknown>));
      imageUrl = String(body.image_url ?? '').trim();
      q = String(body.q ?? '').trim();
      const c = String(body.country ?? '').trim();
      if (c) country = c;
    } else {
      const url = new URL(req.url);
      imageUrl = url.searchParams.get('image_url') ?? '';
      q = url.searchParams.get('q') ?? '';
      country = url.searchParams.get('country') ?? 'us';
    }
    if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
      return jsonRes({ success: false, error: 'missing or invalid image_url' }, 400);
    }

    const serpKey = Deno.env.get('SERPAPI_KEY') ?? '';
    if (!serpKey) return jsonRes({ success: false, error: 'SERPAPI_KEY not configured' }, 500);

    const matches = await searchSerpLens(imageUrl, serpKey, { q: q || undefined, country });

    // Each Lens search is 1 SerpAPI credit. Log so the admin AI usage
    // dashboard rolls this into the existing serpapi line item.
    logAiUsage({
      platform: 'serpapi',
      operation: 'lens-search',
      units: 1,
      metadata: { image_url: imageUrl, q, country, result_count: matches.length },
    });

    return jsonRes({ success: true, count: matches.length, matches });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logAiUsage({
      platform: 'serpapi',
      operation: 'lens-search',
      units: 0,
      status: 'error',
      error_message: message,
    });
    return jsonRes({ success: false, error: message }, 500);
  }
});
