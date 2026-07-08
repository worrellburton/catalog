-- Phase 3b: going-forward duplicate guard. Same clustering the one-time pass
-- used (shared source image OR exact brand+name), keeping the best-verified row
-- per cluster and deactivating the rest with a reversible duplicate_of: stamp.
-- Killswitch-gated OFF: the cron runs but only reports the count until enabled.

insert into public.app_settings (key, value) values ('image_dedup_enabled', 'false')
on conflict (key) do nothing;

-- Returns dup rows found (deactivated if the killswitch is on, else just
-- reported). Uses a reusable view of the clustering so the count and the update
-- share one definition and the function is safe to call repeatedly per txn.
create or replace view public.v_product_dup_drops as
  with base as (
    select id, image_verified, scrape_status,
           coalesce(jsonb_array_length(images),0) as nimg, created_at,
           coalesce(images_raw->>0, image_url) as img_key,
           lower(btrim(coalesce(brand,'')))||'|'||lower(btrim(coalesce(name,''))) as name_key
    from products where is_active
  ),
  img_shared as (select img_key from base group by img_key having count(*) > 1),
  clustered as (
    select b.*, case when s.img_key is not null then 'img:'||b.img_key else 'name:'||b.name_key end as cluster
    from base b left join img_shared s on s.img_key = b.img_key
  ),
  ranked as (
    select *, count(*) over (partition by cluster) as grp,
      row_number() over (partition by cluster
        order by image_verified desc nulls last, (scrape_status='done') desc, nimg desc, created_at asc) as rn,
      first_value(id) over (partition by cluster
        order by image_verified desc nulls last, (scrape_status='done') desc, nimg desc, created_at asc) as keep_id
    from clustered
  )
  select id, keep_id from ranked where grp > 1 and rn > 1;

create or replace function public.reconcile_dedup()
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_enforce boolean;
  v_n       int;
begin
  v_enforce := coalesce((select value from app_settings where key = 'image_dedup_enabled'), 'false') = 'true';
  select count(*) into v_n from public.v_product_dup_drops;
  if v_enforce and v_n > 0 then
    update products p
      set is_active = false, image_verify_note = 'duplicate_of:'||d.keep_id
    from public.v_product_dup_drops d where p.id = d.id;
  end if;
  return v_n;  -- dup rows (deactivated if enforce on, else would-deactivate count)
end;
$function$;

select cron.schedule('image-reconcile-dedup', '45 7 * * *', $$select public.reconcile_dedup()$$);
