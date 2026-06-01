-- Persisted catalog feed order. The admin's "Recommend Order" (and any
-- saved manual order) writes a per-type rank here; the consumer feed
-- (getHomeFeed / getLooks) orders by it so what the admin arranges is
-- what shoppers see. NULL = unranked → sorts after ranked items by the
-- existing tiebreakers. Lower rank = earlier in the feed.
alter table public.products add column if not exists feed_rank integer;
alter table public.looks    add column if not exists feed_rank integer;
create index if not exists products_feed_rank_idx on public.products (feed_rank) where feed_rank is not null;
create index if not exists looks_feed_rank_idx    on public.looks    (feed_rank) where feed_rank is not null;

create or replace function public.apply_feed_order(look_ids uuid[], product_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (is_admin = true or role in ('admin', 'super_admin'))
  ) then
    raise exception 'Admin privileges required' using errcode = '42501';
  end if;

  update public.looks    set feed_rank = null where feed_rank is not null;
  update public.products set feed_rank = null where feed_rank is not null;

  update public.looks l
    set feed_rank = x.ord
    from unnest(look_ids) with ordinality as x(id, ord)
    where l.id = x.id;

  update public.products p
    set feed_rank = x.ord
    from unnest(product_ids) with ordinality as x(id, ord)
    where p.id = x.id;
end;
$function$;

grant execute on function public.apply_feed_order(uuid[], uuid[]) to authenticated;
