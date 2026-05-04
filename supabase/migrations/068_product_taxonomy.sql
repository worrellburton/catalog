-- 068 — product_taxonomy: synonym registry for search query expansion
-- Stores canonical type → synonyms/keywords mappings so the nl-search
-- Haiku prompt can inject dynamic few-shot examples for any new types
-- added to the catalog.  Seeded from the product_types_canonical view.

create table if not exists public.product_taxonomy (
  type         text primary key,
  category     text check (category in ('fashion','beauty','home','tech','lifestyle','other')),
  synonyms     text[],
  keywords     text,
  generated_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Seed from canonical types view, assigning category from known mappings.
insert into public.product_taxonomy (type, category)
select
  ptc.type,
  case
    when ptc.type in (
      'Top','Jacket','Pants','Shorts','Skirt','Dress','Coat',
      'Activewear','Loungewear','Underwear','Swimwear',
      'Sneakers','Boots','Sandals','Heels','Loafers','Flats','Mules',
      'Hat','Bag','Scarf','Socks'
    ) then 'fashion'
    when ptc.type in (
      'Fragrance','Skincare','Haircare','Makeup','Nails'
    ) then 'beauty'
    when ptc.type in (
      'Decor','Furniture','Bedding','Lighting','Kitchenware'
    ) then 'home'
    when ptc.type in (
      'Electronics','Gadgets','Accessories'
    ) then 'tech'
    when ptc.type in (
      'Books','Sports','Fitness','Food','Wellness'
    ) then 'lifestyle'
    else 'other'
  end
from public.product_types_canonical ptc
on conflict (type) do nothing;

-- updated_at trigger
create or replace function public.set_taxonomy_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists taxonomy_updated_at on public.product_taxonomy;
create trigger taxonomy_updated_at
  before update on public.product_taxonomy
  for each row execute function public.set_taxonomy_updated_at();

-- RLS
alter table public.product_taxonomy enable row level security;

-- Anon and authenticated users can read (needed for the admin UI)
create policy "Public read taxonomy"
  on public.product_taxonomy for select
  using (true);

-- Only service role can write (edge functions use service role key)
create policy "Service write taxonomy"
  on public.product_taxonomy for all
  using (auth.role() = 'service_role');
