// rainforest-product-lookup
//
// Thin proxy over Rainforest API's Product Data endpoint. Keeps
// RAINFOREST_API_KEY server-side and returns a normalized product shape the
// admin can ingest directly into public.products.
//
// POST body: { asin?: string; url?: string; amazon_domain?: string } — one of
// asin / url is required.
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

interface RainforestPrice {
  value?: number;
  currency?: string;
  raw?: string;
  symbol?: string;
}

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

interface RainforestResponse {
  request_info?: { success?: boolean; message?: string };
  product?: RainforestProduct;
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
}

function normalize(product: RainforestProduct): NormalizedProduct {
  const price = product.buybox_winner?.price;
  const mainImage = product.main_image?.link ?? product.images?.[0]?.link ?? null;
  return {
    asin: product.asin ?? null,
    name: product.title ?? '',
    brand: product.brand ?? null,
    price: price?.raw ?? (typeof price?.value === 'number' && price.symbol ? `${price.symbol}${price.value}` : null),
    currency: price?.currency ?? null,
    description: product.description ?? null,
    url: product.link ?? null,
    image_url: mainImage,
    images: (product.images ?? []).map(i => i.link).filter((s): s is string => typeof s === 'string' && s.length > 0),
    categories: (product.categories ?? []).map(c => c.name).filter(Boolean),
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

  let body: { asin?: string; url?: string; amazon_domain?: string };
  try {
    body = await req.json();
  } catch {
    return errorRes('Invalid JSON body');
  }

  const asin = body.asin?.trim();
  const url = body.url?.trim();
  const amazonDomain = body.amazon_domain?.trim() || 'amazon.com';

  if (!asin && !url) {
    return errorRes('Provide asin or url');
  }

  const params = new URLSearchParams({
    api_key: apiKey,
    type: 'product',
    amazon_domain: amazonDomain,
  });
  if (asin) params.set('asin', asin);
  if (url) params.set('url', url);

  let rainforestRes: Response;
  try {
    rainforestRes = await fetch(`https://api.rainforestapi.com/request?${params.toString()}`, {
      method: 'GET',
    });
  } catch (err) {
    return errorRes(`Rainforest request failed: ${err instanceof Error ? err.message : String(err)}`, 502);
  }

  if (!rainforestRes.ok) {
    const text = await rainforestRes.text();
    return errorRes(
      `Rainforest returned ${rainforestRes.status}: ${text.slice(0, 500)}`,
      rainforestRes.status === 401 || rainforestRes.status === 403 ? 502 : 502
    );
  }

  const payload = (await rainforestRes.json()) as RainforestResponse;
  if (payload.request_info?.success === false) {
    return errorRes(`Rainforest error: ${payload.request_info.message ?? 'unknown'}`, 502);
  }
  if (!payload.product) {
    return errorRes('Rainforest returned no product');
  }

  return jsonRes({ success: true, product: normalize(payload.product) });
});
