-- Persistent section sequence for consumer-facing pages.
--
-- One row per section per page. sort_order is the display index;
-- enabled drives whether the consumer renderer shows the section
-- at all. Admin /admin/pages writes here; consumer renderers
-- (ProductPage, LookOverlay) will read from a small RPC in a
-- follow-up phase.

create table if not exists public.page_sections (
  page         text not null,
  section_key  text not null,
  label        text not null,
  description  text,
  sort_order   int  not null default 0,
  enabled      boolean not null default true,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  primary key (page, section_key)
);

alter table public.page_sections enable row level security;

drop policy if exists "page_sections_public_read" on public.page_sections;
create policy "page_sections_public_read"
  on public.page_sections
  for select
  using (true);

drop policy if exists "page_sections_admin_write" on public.page_sections;
create policy "page_sections_admin_write"
  on public.page_sections
  for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

insert into public.page_sections (page, section_key, label, description, sort_order) values
  ('product', 'hero',                'Hero',                'The selected product card + creator chip at the top of the page.', 0),
  ('product', 'similar',             'Similar',             'Similar products from the same brand or look graph.',              1),
  ('product', 'popular',             'Popular',             'Most-engaged products from the same category.',                    2),
  ('product', 'you-might-also-like', 'You might also like', 'Infinite editorial feed scoped to the shopper.',                   3),
  ('looks',   'video',               'Video / hero media',     'Full-bleed video on the left half of the overlay.',                 0),
  ('looks',   'creator-chip',        'Creator chip',           'Avatar + handle + follow button at the bottom of the media.',      1),
  ('looks',   'tabs',                'Products / About tabs',  'Tab nav between the products list and the creator about panel.',   2),
  ('looks',   'products',            'Products list',          'All garments tagged on the look, sorted by garment role.',         3),
  ('looks',   'more-from-creator',   'More from this creator', 'Horizontal rail of additional looks from the same creator.',       4)
on conflict (page, section_key) do nothing;
