-- Elite flag: lets admins hand-curate a small set of creatives + their parent
-- products to surface in the investor deck v1.1 background feed. When a
-- creative is flipped to elite in the admin Creative view, its product is
-- flipped too so the deck filter can key off either.
alter table public.products
  add column if not exists is_elite boolean not null default false;

alter table public.product_ads
  add column if not exists is_elite boolean not null default false;

alter table public.generated_videos
  add column if not exists is_elite boolean not null default false;

comment on column public.products.is_elite is
  'Admin curation flag: true when this product has at least one elite creative. Used by investor deck v1.1.';
comment on column public.product_ads.is_elite is
  'Admin curation flag: true when this creative is hand-picked for the deck v1.1 background feed.';
comment on column public.generated_videos.is_elite is
  'Admin curation flag: true when this look video is hand-picked for the deck v1.1 background feed.';

create index if not exists products_is_elite_idx on public.products (is_elite) where is_elite = true;
create index if not exists product_ads_is_elite_idx on public.product_ads (is_elite) where is_elite = true;
create index if not exists generated_videos_is_elite_idx on public.generated_videos (is_elite) where is_elite = true;
