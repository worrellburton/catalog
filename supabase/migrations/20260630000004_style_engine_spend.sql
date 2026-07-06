-- Style Up simulation spend — running total of style-engine Claude cost.
-- Each style-engine run logs to ai_usage_logs (operation='style-engine') with a
-- per-call estimated_cost_usd; this aggregates it for the Styling cockpit's
-- "total simulation spend" readout. is_admin gated. See docs/CATALOG_SEEDING.md.

create or replace function public.style_engine_spend()
returns table(total_cost numeric, runs bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;
  return query
    select coalesce(sum(estimated_cost_usd), 0)::numeric, count(*)::bigint
    from public.ai_usage_logs
    where operation = 'style-engine';
end $$;

grant execute on function public.style_engine_spend() to authenticated, service_role;
