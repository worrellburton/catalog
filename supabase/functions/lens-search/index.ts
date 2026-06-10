// Google Lens visual-match proxy via SerpAPI, with a two-table
// persistence cache so reopening the same Style image (or a
// previously-cropped region) skips the SerpAPI round trip.
//
// Required Supabase secrets:
//   SERPAPI_KEY                 — SerpAPI Google Lens engine (paid plan)
//   SUPABASE_URL                — for cache reads/writes
//   SUPABASE_SERVICE_ROLE_KEY   — for cache reads/writes
//
// Request body:
//   {
//     image_url: string;
//     q?: string;
//     country?: string;
//     bbox?: { x: number; y: number; w: number; h: number }; // 0..1
//   }
//
// Response:
//   {
//     success: true,
//     count,
//     matches: NormalizedMatch[],
//     cached: boolean,           // true if served from lens_searches
//     search_id: string          // primary key of the lens_searches row
//   }

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

interface BBox { x: number; y: number; w: number; h: number }

interface NormalizedMatch {
  id?: string | null;          // populated on cache hits + post-insert
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
  ingested_product_id?: string | null;
}

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

interface SerpLensPrice { value?: string; extracted_value?: number; currency?: string }
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

async function callLens(params: URLSearchParams): Promise<{ exact: SerpLensMatch[]; visual: SerpLensMatch[] }> {
  const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
  if (!res.ok) throw new Error(`SerpAPI ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return {
    exact: Array.isArray(json.exact_matches) ? json.exact_matches : [],
    visual: Array.isArray(json.visual_matches) ? json.visual_matches : [],
  };
}

async function searchSerpLens(
  imageUrl: string,
  apiKey: string,
  opts: { q?: string; country: string },
): Promise<NormalizedMatch[]> {
  // type=products narrows SerpAPI's Lens response to shoppable items
  // only — Google Shopping-style entries with prices and merchant
  // links, NOT generic Google web results. That's the user-visible
  // promise: every tile in the grid should be something you can
  // actually buy and try on. If the products engine comes back empty
  // (rare, but possible on stylized images), we fall back to type=all
  // and run the same shoppability post-filter so the experience never
  // dead-ends to zero matches.
  const baseParams = new URLSearchParams({
    engine: 'google_lens',
    url: imageUrl,
    api_key: apiKey,
    country: opts.country,
    hl: 'en',
  });
  if (opts.q) baseParams.set('q', opts.q);

  const productParams = new URLSearchParams(baseParams);
  productParams.set('type', 'products');
  let { exact, visual } = await callLens(productParams);
  let merged: SerpLensMatch[] = [...exact, ...visual];

  if (merged.length === 0) {
    const allParams = new URLSearchParams(baseParams);
    allParams.set('type', 'all');
    ({ exact, visual } = await callLens(allParams));
    merged = [...exact, ...visual];
  }

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

// Canonical bbox JSON for fingerprinting — sorted keys, 4-decimal
// precision so tiny float drift between client resizes doesn't blow
// the cache.
function canonicalBboxJson(bbox: BBox | null | undefined): string {
  if (!bbox) return 'null';
  const round = (n: number) => Math.round(n * 10000) / 10000;
  return JSON.stringify({
    x: round(bbox.x),
    y: round(bbox.y),
    w: round(bbox.w),
    h: round(bbox.h),
  });
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Read the JWT-attached user id so we can attribute searches in the
// cache for analytics. Service-role calls (no user JWT) get null.
function readUserIdFromJwt(req: Request): string | null {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.sub === 'string' ? json.sub : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  try {
    let imageUrl = '';
    let q = '';
    let country = 'us';
    let bbox: BBox | null = null;
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({} as Record<string, unknown>));
      imageUrl = String(body.image_url ?? '').trim();
      q = String(body.q ?? '').trim();
      const c = String(body.country ?? '').trim();
      if (c) country = c;
      if (body.bbox && typeof body.bbox === 'object') {
        const b = body.bbox as Record<string, unknown>;
        const x = Number(b.x), y = Number(b.y), w = Number(b.w), h = Number(b.h);
        if (
          [x, y, w, h].every(n => Number.isFinite(n) && n >= 0 && n <= 1) && w > 0 && h > 0
        ) {
          bbox = { x, y, w, h };
        }
      }
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const cacheEnabled = !!supabaseUrl && !!serviceKey;
    const admin = cacheEnabled ? createClient(supabaseUrl, serviceKey) : null;

    const fingerprint = await sha256Hex(`${imageUrl}|${q}|${canonicalBboxJson(bbox)}|${country}`);
    const userId = readUserIdFromJwt(req);

    // ── Cache hit path ────────────────────────────────────────────────────
    if (admin) {
      const { data: existing } = await admin
        .from('lens_searches')
        .select('id, result_count')
        .eq('fingerprint', fingerprint)
        .maybeSingle();

      if (existing?.id) {
        const { data: rows } = await admin
          .from('lens_results')
          .select('id, position, title, source, source_icon, link, thumbnail, image, price, brand, rating, reviews, ingested_product_id')
          .eq('search_id', existing.id)
          .order('position', { ascending: true });

        if (rows && rows.length > 0) {
          return jsonRes({
            success: true,
            count: rows.length,
            cached: true,
            search_id: existing.id,
            matches: rows as NormalizedMatch[],
          });
        }
      }
    }

    // ── Miss path: hit SerpAPI ───────────────────────────────────────────
    const matches = await searchSerpLens(imageUrl, serpKey, { q: q || undefined, country });

    logAiUsage({
      platform: 'serpapi',
      operation: 'lens-search',
      units: 1,
      metadata: { image_url: imageUrl, q, country, result_count: matches.length, cached: false },
    });

    // Persist in the cache so subsequent calls (this user or any other)
    // skip the SerpAPI round trip. Errors here are non-fatal — caller
    // still gets the live results.
    let searchId: string | null = null;
    if (admin) {
      const { data: searchRow, error: searchErr } = await admin
        .from('lens_searches')
        .insert({
          user_id: userId,
          source_image_url: imageUrl,
          q,
          bbox,
          fingerprint,
          result_count: matches.length,
          country,
        })
        .select('id')
        .single();

      if (!searchErr && searchRow?.id) {
        searchId = searchRow.id as string;
        if (matches.length > 0) {
          const rows = matches.map((m) => ({
            search_id: searchId,
            position: m.position,
            title: m.title,
            source: m.source || null,
            source_icon: m.source_icon || null,
            link: m.link,
            thumbnail: m.thumbnail || null,
            image: m.image || null,
            price: m.price || null,
            brand: m.brand || null,
            rating: m.rating,
            reviews: m.reviews,
          }));
          const { data: inserted } = await admin
            .from('lens_results')
            .insert(rows)
            .select('id, link');

          // Pipe the freshly-minted result ids back into the response
          // so the client can use them as the stable key for selection
          // + later patching of ingested_product_id by lens-ingest.
          if (inserted) {
            const idByLink = new Map<string, string>(
              (inserted as { id: string; link: string }[]).map(r => [r.link, r.id]),
            );
            for (const m of matches) {
              const id = idByLink.get(m.link);
              if (id) m.id = id;
            }
          }
        }
      }
    }

    return jsonRes({
      success: true,
      count: matches.length,
      cached: false,
      search_id: searchId,
      matches,
    });
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
