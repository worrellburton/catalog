-- Brand → logo URL mapping for the consumer feed's "show brand logos"
-- dial. Public-read so anon shoppers can fetch logos; admin-only
-- writes. Brand name lowercased as the primary key for case-
-- insensitive lookups.

create table if not exists public.brand_logos (
  brand text primary key,
  logo_url text not null,
  display_name text,
  updated_at timestamptz not null default now()
);

alter table public.brand_logos enable row level security;

drop policy if exists brand_logos_read on public.brand_logos;
create policy brand_logos_read on public.brand_logos
  for select using (true);

drop policy if exists brand_logos_admin_write on public.brand_logos;
create policy brand_logos_admin_write on public.brand_logos
  for all using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and (is_admin = true or role in ('admin', 'super_admin'))
    )
  ) with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and (is_admin = true or role in ('admin', 'super_admin'))
    )
  );
