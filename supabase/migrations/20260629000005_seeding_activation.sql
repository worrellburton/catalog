-- Catalog Seeding — activation: promote-only, gated go-live decision.
-- Flips is_active=true ONLY for products that pass product_ready_for_feed()
-- (image + occasion) and are not deliberately suppressed. NEVER demotes an
-- existing active row (so it can't shrink today's feed). No-ops unless
-- seeding_enabled='true'. The image-gate trigger (071) remains the hard floor.
-- See docs/CATALOG_SEEDING.md.

create or replace function public.run_seeding_activation()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  enabled text;
begin
  select value into enabled from public.app_settings where key = 'seeding_enabled';
  if coalesce(enabled, 'false') <> 'true' then
    return 0;
  end if;

  update public.products p
    set is_active = true
  where p.is_active = false
    and p.is_platform is not false
    and coalesce(p.scrape_status, 'done') <> 'failed'
    and public.product_ready_for_feed(p)
    and not exists (
      select 1 from public.admin_hidden_products h
      where lower(h.brand) = lower(coalesce(p.brand, ''))
        and lower(h.name)  = lower(coalesce(p.name, ''))
    );

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.run_seeding_activation() from public;
grant execute on function public.run_seeding_activation() to service_role;
