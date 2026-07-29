-- RPCs backing /admin/pipeline/health. These were applied live before their
-- file existed; committed here so the repo stays the source of truth per
-- CLAUDE.md §7. Without the file, any rebuild loses all four dashboard panels
-- AND (because the page swallows RPC errors) renders that loss as
-- "no products yet / $0.00" - i.e. fails into "everything is fine and free".
create or replace function public.pipeline_funnel()
returns table(stage text, n bigint, oldest_age interval)
language sql stable as $$
  select public.pipeline_stage(p.*) as stage,
         count(*),
         max(now() - p.created_at)
    from public.products p
   group by 1 order by 2 desc;
$$;

create or replace function public.pipeline_spend_summary()
returns table(platform text, operation text, calls bigint, month_usd numeric, total_usd numeric)
language sql stable as $$
  select platform, operation, count(*),
         round(coalesce(sum(estimated_cost_usd) filter (
           where created_at >= date_trunc('month', now())), 0)::numeric, 2),
         round(coalesce(sum(estimated_cost_usd), 0)::numeric, 2)
    from public.ai_usage_logs
   group by 1, 2
   order by 4 desc, 3 desc;
$$;

-- Numerator and denominator must cover the SAME period. An earlier version
-- divided this-month spend by the ALL-TIME published count, which reported
-- $0.18/product for a month that actually cost $10.00 each - and got cheaper
-- every month as history accumulated.
create or replace function public.pipeline_cost_per_published()
returns numeric language sql stable as $$
  select case when n = 0 then 0
              else round((public.creative_month_spend() / n)::numeric, 4) end
    from (
      select count(*)::numeric as n
        from public.pipeline_events
       where stage = 'publish' and event = 'published'
         and created_at >= date_trunc('month', now())
    ) s;
$$;
