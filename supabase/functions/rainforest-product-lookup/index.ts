// rainforest-product-lookup
//
// Thin proxy over Rainforest API. Keeps RAINFOREST_API_KEY server-side.
// Two modes:
//   POST { asin } / { url }   → type=product, returns one normalized product
//   POST { keyword }          → type=search, returns a list of normalized products
//
// Auth: standard Supabase authenticated user bearer token. Same pattern as
// manage-looks.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

function errorRes(message: string, status = 400) {
  return jsonRes({ success: false, error: message }, status);
}

interface RainforestPrice { value?: number; currency?: string; raw?: string; symbol?: string }
interface RainforestImage { link?: string }

interface RainforestProduct {
  asin?: string;
  title?: string;
  brand?: string;
  description?: string;
  link?: string;
  main_image?: RainforestImage;
  images?: RainforestImage[];
  buybox_winner?: { price?: RainforestPrice };
  categories?: { name: string }[];
}

interface RainforestSearchResult {
  asin?: string;
  title?: string;
  brand?: string;
  link?: string;
  image?: string;
  rating?: number;
  ratings_total?: number;
  price?: RainforestPrice;
  prices?: RainforestPrice[];
  is_prime?: boolean;
}

interface NormalizedProduct {
  asin: string | null;
  name: string;
  brand: string | null;
  price: string | null;
  currency: string | null;
  description: string | null;
  url: string | null;
  image_url: string | null;
  images: string[];
  categories: string[];
  rating?: number | null;
  rating_count?: number | null;
}

function priceString(p?: RainforestPrice): string | null {
  if (!p) return null;
  if (p.raw) return p.raw;
  if (typeof p.value === 'number' && p.symbol) return `${p.symbol}${p.value}`;
  return null;
}

function normalizeProduct(p: RainforestProduct): NormalizedProduct {
  const price = p.buybox_winner?.price;
  const mainImage = p.main_image?.link ?? p.images?.[0]?.link ?? null;
  return {
    asin: p.asin ?? null,
    name: p.title ?? '',
    brand: p.brand ?? null,
    price: priceString(price),
    currency: price?.currency ?? null,
    description: p.description ?? null,
    url: p.link ?? null,
    image_url: mainImage,
    images: (p.images ?? []).map(i => i.link).filter((s): s is string => typeof s === 'string' && s.length > 0),
    categories: (p.categories ?? []).map(c => c.name).filter(Boolean),
  };
}

function normalizeSearchResult(r: RainforestSearchResult): NormalizedProduct {
  const price = r.price ?? r.prices?.[0];
  return {
    asin: r.asin ?? null,
    name: r.title ?? '',
    brand: r.brand ?? null,
    price: priceString(price),
    currency: price?.currency ?? null,
    description: null,
    url: r.link ?? null,
    image_url: r.image ?? null,
    images: r.image ? [r.image] : [],
    categories: [],
    rating: typeof r.rating === 'number' ? r.rating : null,
    rating_count: typeof r.ratings_total === 'number' ? r.ratings_total : null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return errorRes('POST required', 405);
  }

  const apiKey = Deno.env.get('RAINFOREST_API_KEY');
  if (!apiKey) {
    return errorRes('RAINFOREST_API_KEY is not configured. Set it in project secrets.', 500);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return errorRes('Missing or invalid Authorization header', 401);
  }
  const token = authHeader.replace('Bearer ', '');

  const authClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: { user }, error: userError } = await authClient.auth.getUser(token);
  if (userError || !user) {
    return errorRes('Unauthorized', 401);
  }

  let body: { asin?: string; url?: string; keyword?: string; amazon_domain?: string; limit?: number };
  try {
    body = await req.json();
  } catch {
    return errorRes('Invalid JSON body');
  }

  const asin         = body.asin?.trim();
  const url          = body.url?.trim();
  const keyword      = body.keyword?.trim();
  const amazonDomain = body.amazon_domain?.trim() || 'amazon.com';
  const limit        = Math.max(1, Math.min(40, body.limit ?? 20));

  if (!asin && !url && !keyword) {
    return errorRes('Provide asin, url, or keyword');
  }

  // --- Search mode (keyword) ------------------------------------------------
  if (keyword) {
    const params = new URLSearchParams({
      api_key: apiKey,
      type: 'search',
      amazon_domain: amazonDomain,
      search_term: keyword,
    });
    let res: Response;
    try {
      res = await fetch(`https://api.rainforestapi.com/request?${params.toString()}`);
    } catch (err) {
      return errorRes(`Rainforest request failed: ${err instanceof Error ? err.message : String(err)}`, 502);
    }
    if (!res.ok) {
      const text = await res.text();
      return errorRes(`Rainforest returned ${res.status}: ${text.slice(0, 500)}`, 502);
    }
    const payload = await res.json() as {
      request_info?: { success?: boolean; message?: string };
      search_results?: RainforestSearchResult[];
    };
    if (payload.request_info?.success === false) {
      return errorRes(`Rainforest error: ${payload.request_info.message ?? 'unknown'}`, 502);
    }
    const results = (payload.search_results ?? [])
      .slice(0, limit)
      .map(normalizeSearchResult)
      .filter(p => p.name && p.url);
    return jsonRes({ success: true, products: results });
  }

  // --- Product mode (asin / url) --------------------------------------------
  const params = new URLSearchParams({
    api_key: apiKey,
    type: 'product',
    amazon_domain: amazonDomain,
  });
  if (asin) params.set('asin', asin);
  if (url) params.set('url', url);

  let res: Response;
  try {
    res = await fetch(`https://api.rainforestapi.com/request?${params.toString()}`);
  } catch (err) {
    return errorRes(`Rainforest request failed: ${err instanceof Error ? err.message : String(err)}`, 502);
  }
  if (!res.ok) {
    const text = await res.text();
    return errorRes(`Rainforest returned ${res.status}: ${text.slice(0, 500)}`, 502);
  }
  const payload = await res.json() as {
    request_info?: { success?: boolean; message?: string };
    product?: RainforestProduct;
  };
  if (payload.request_info?.success === false) {
    return errorRes(`Rainforest error: ${payload.request_info.message ?? 'unknown'}`, 502);
  }
  if (!payload.product) {
    return errorRes('Rainforest returned no product');
  }
  return jsonRes({ success: true, product: normalizeProduct(payload.product) });
});
