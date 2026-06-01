-- Unified feed order. The /admin/catalogs FEED editor arranges looks AND
-- products in ONE drag sequence. The previous apply_feed_order(look_ids,
-- product_ids) ranked each type separately (look #0 and product #0 both got
-- feed_rank 0), so the cross-type interleave the admin arranged was lost on
-- the consumer feed. This 1-arg version takes the full ordered key list
-- ('look:<uuid>' / 'product:<uuid>') and writes feed_rank = the item's
-- position in that unified sequence to the right table, so looks and
-- products share one rank space and getHomeFeed reproduces the exact order.
create or replace function public.apply_feed_order(ordered_keys text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  k text;
  i int := 0;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and (is_admin = true or role in ('admin','super_admin'))
  ) then
    raise exception 'Admin privileges required' using errcode = '42501';
  end if;
  foreach k in array ordered_keys loop
    if k like 'look:%' then
      update public.looks set feed_rank = i where id = substring(k from 6)::uuid;
    elsif k like 'product:%' then
      update public.products set feed_rank = i where id = substring(k from 9)::uuid;
    end if;
    i := i + 1;
  end loop;
end;
$$;
grant execute on function public.apply_feed_order(text[]) to authenticated;
