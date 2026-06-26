// shopify-sync — JWT-gated. A brand owner/admin pulls their Shopify catalog and
// upserts each product as ONE `products` row (source='shopify', brand_id set).
// The existing Postgres triggers then fan out (pick-primary-image, embed-product).
// Synced products show up in the admin panel like any product; an admin promotes
// them to the consumer feed (which requires a generated primary_video).
//
// Idempotent on (brand_id, shopify_product_id). The upsert deliberately OMITS
// is_active / gender / type so admin curation survives re-syncs (new rows get
// the column defaults: is_active=true).
//
// Chunked: each call processes up to MAX_PAGES pages (or ~time budget) and
// returns { hasMore, cursor } so the client can continue large catalogs.
//
// Deploy with verify_jwt = TRUE.
// Secrets: SHOPIFY_API_VERSION (optional, default 2025-07).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
function err(message: string, status = 400) {
  return json({ success: false, error: message }, status);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 50;
const MAX_PAGES = 20;          // up to 1000 products per invocation
const TIME_BUDGET_MS = 100_000; // leave headroom under the ~150s edge wall

const PRODUCTS_QUERY = `
  query syncProducts($cursor: String) {
    products(first: ${PAGE_SIZE}, after: $cursor, query: "status:active") {
      nodes {
        id
        handle
        title
        description
        onlineStoreUrl
        priceRangeV2 { minVariantPrice { amount currencyCode } }
        images(first: 10) { nodes { url } }
        variants(first: 25) { nodes { price sku selectedOptions { name value } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

interface ShopifyNode {
  id: string;
  handle: string;
  title: string;
  description: string | null;
  onlineStoreUrl: string | null;
  priceRangeV2?: { minVariantPrice?: { amount?: string; currencyCode?: string } };
  images?: { nodes?: { url: string }[] };
  variants?: { nodes?: { price: string; sku: string | null; selectedOptions: { name: string; value: string }[] }[] };
}

function mapRow(node: ShopifyNode, shop: string, brandId: string, brandName: string, nowIso: string) {
  const imageUrls = (node.images?.nodes ?? []).map((n) => n.url).filter(Boolean);
  const variants = (node.variants?.nodes ?? []).map((v) => ({ price: v.price, sku: v.sku, options: v.selectedOptions }));
  const price = node.priceRangeV2?.minVariantPrice?.amount ?? variants[0]?.price ?? null;
  return {
    brand_id: brandId,
    shopify_product_id: node.id,
    source: 'shopify',
    name: node.title ?? null,
    brand: brandName,
    description: node.description || null,
    url: node.onlineStoreUrl || `https://${shop}/products/${node.handle}`,
    image_url: imageUrls[0] ?? null,
    images: imageUrls,
    price: price ? String(price) : null,
    currency: node.priceRangeV2?.minVariantPrice?.currencyCode ?? null,
    variants,
    scrape_status: 'done',
    updated_at: nowIso,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return err('Method not allowed', 405);
  const startedAt = Date.now();

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const apiVersion = Deno.env.get('SHOPIFY_API_VERSION') ?? '2025-07';

  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return err('Missing Authorization header', 401);
  const token = auth.slice(7);

  const svc = createClient(supabaseUrl, serviceKey);
  const { data: { user }, error: userErr } = await svc.auth.getUser(token);
  if (userErr || !user) return err('Unauthorized', 401);

  let body: { brandId?: string; cursor?: string | null };
  try { body = await req.json(); } catch { return err('Invalid JSON body'); }

  const brandId = (body.brandId || '').trim();
  if (!UUID_RE.test(brandId)) return err('Invalid brandId');

  // Membership: active owner/admin only.
  const { data: member } = await svc
    .from('brand_members').select('role, status')
    .eq('brand_id', brandId).eq('user_id', user.id).maybeSingle();
  if (!member || member.status !== 'active' || !['owner', 'admin'].includes(member.role)) {
    return err('You must be an owner or admin of this brand to sync.', 403);
  }

  // Connected store + brand name for the denormalized `brand` column.
  const { data: session } = await svc
    .from('brand_shopify_sessions').select('shop, access_token')
    .eq('brand_id', brandId).maybeSingle();
  if (!session?.shop || !session?.access_token) return err('Shopify is not connected for this brand.', 400);

  const { data: brandRow } = await svc.from('brands').select('name, canonical_brand').eq('id', brandId).maybeSingle();
  const brandName = brandRow?.canonical_brand || brandRow?.name || null;

  const endpoint = `https://${session.shop}/admin/api/${apiVersion}/graphql.json`;
  let cursor: string | null = body.cursor ?? null;
  let synced = 0;
  let pages = 0;
  let hasNextPage = true;

  try {
    while (hasNextPage && pages < MAX_PAGES && Date.now() - startedAt < TIME_BUDGET_MS) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: PRODUCTS_QUERY, variables: { cursor } }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return err(`Shopify API error ${res.status}. ${text.slice(0, 200)}`, 502);
      }
      const payload = await res.json();
      if (payload.errors) return err(`Shopify GraphQL error: ${JSON.stringify(payload.errors).slice(0, 200)}`, 502);

      const conn = payload?.data?.products;
      const nodes: ShopifyNode[] = conn?.nodes ?? [];
      const nowIso = new Date().toISOString();
      const rows = nodes.map((n) => mapRow(n, session.shop, brandId, brandName, nowIso));

      if (rows.length > 0) {
        const { error: upsertErr } = await svc
          .from('products')
          .upsert(rows, { onConflict: 'brand_id,shopify_product_id' });
        if (upsertErr) return err(`Failed to save products: ${upsertErr.message}`, 500);
        synced += rows.length;
      }

      hasNextPage = Boolean(conn?.pageInfo?.hasNextPage);
      cursor = conn?.pageInfo?.endCursor ?? null;
      pages += 1;
    }
  } catch (e) {
    return err(`Sync failed: ${e instanceof Error ? e.message : String(e)}`, 500);
  }

  return json({ success: true, synced, hasMore: hasNextPage, cursor: hasNextPage ? cursor : null });
});
