-- Catalog Seeding — aggregate real search demand into seed_targets.
-- Groups search_logs by normalized query, upserts a 'keyword' seed target.
-- NEVER overwrites status, so operator decisions (rejected/approved/paused)
-- and run stats survive a refresh. Excludes test 'filler-%' rows.
-- See docs/CATALOG_SEEDING.md.

create or replace function public.refresh_seed_targets_from_searches()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  with agg as (
    select
      lower(btrim(query))           as term,
      count(*)::int                 as hits,
      (max(results_count) = 0)      as zero_result
    from public.search_logs
    where query is not null
      and length(btrim(query)) >= 2
      and lower(query) not like 'filler-%'
    group by lower(btrim(query))
  )
  insert into public.seed_targets (term, kind, status, search_hits, zero_result, priority)
  select
    term, 'keyword', 'pending', hits, zero_result,
    hits + case when zero_result then 100 else 0 end
  from agg
  on conflict (lower(term), kind) do update
    set search_hits = excluded.search_hits,
        zero_result = excluded.zero_result,
        priority    = excluded.priority,
        updated_at  = now();

  get diagnostics affected = row_count;
  return affected;
end $$;

grant execute on function public.refresh_seed_targets_from_searches() to authenticated, service_role;
