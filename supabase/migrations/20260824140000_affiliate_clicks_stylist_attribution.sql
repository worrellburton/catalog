-- Phase 4: attribute affiliate clickouts to a stylist thread so the admin
-- panel can show per-stylist clickout counts. Nullable; the client sets both
-- only when the user shops from inside a style_up_threads context.

alter table public.affiliate_clicks
  add column if not exists stylist_id uuid,
  add column if not exists thread_id uuid;

create index if not exists affiliate_clicks_stylist_id_idx
  on public.affiliate_clicks (stylist_id)
  where stylist_id is not null;

create index if not exists affiliate_clicks_thread_id_idx
  on public.affiliate_clicks (thread_id)
  where thread_id is not null;
