-- Shopify OAuth session storage (Phase 2 of the Shopify brand portal).
--
-- One row per connected brand. Fixes the OLD catalog-server model's worst bug:
-- a real brand_id FK instead of the `state LIKE '%"brandId":"<id>"%'` JSON-string
-- lookup. The admin access token is service-role-only; the brand UI never reads
-- it — it learns "connected?" from brands.shopify_shop (set by shopify-callback).

create table if not exists public.brand_shopify_sessions (
  brand_id                uuid primary key references public.brands(id) on delete cascade,
  shop                    text not null,                 -- <store>.myshopify.com
  access_token            text not null,                 -- Admin API token
  storefront_access_token text,                           -- null until checkout/cart needs it (later phase)
  scope                   text,
  connected_at            timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- One Shopify store maps to at most one brand.
create unique index if not exists brand_shopify_sessions_shop_idx
  on public.brand_shopify_sessions(shop);

-- RLS on, NO policies → only service_role / postgres (the edge functions) can
-- read or write. The access token must never reach the browser.
alter table public.brand_shopify_sessions enable row level security;
