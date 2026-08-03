-- Phase 3: self-healing image reconciler. Two pg_cron jobs, both gated by an
-- app_settings killswitch that ships OFF — the crons run but no-op until an
-- operator flips them on. Nothing here deactivates a product by default.
--
-- reconcile_verify_images  — re-runs verify-product-image on the UNVERIFIED +
--   needs_review tail (never the durable rehosted rows). Catches dead URLs that
--   recover, blocked URLs that become fetchable, and any product that missed
--   verification. SAFE: verify never deactivates.
-- reconcile_retire_dead    — retires products whose images are genuinely DEAD
--   (needs_review:dead) and have stayed dead ≥3 days. Never touches :blocked
--   (renders in a browser) or :no_good (curation call). Gated + dry-run by default.

insert into public.app_settings (key, value) values
  ('image_reconcile_enabled', 'false'),
  ('image_retire_enabled',    'false')
on conflict (key) do nothing;

-- ── self-healing sweep ───────────────────────────────────────────────────────
create or replace function public.reconcile_verify_images(batch int default 25)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_token text;
  v_id    uuid;
  v_n     int := 0;
begin
  if coalesce((select value from app_settings where key = 'image_reconcile_enabled'), 'false') <> 'true' then
    return 0;  -- killswitch off
  end if;

  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'embed_entity_service_key' limit 1;
  if v_token is null or v_token = 'PLACEHOLDER_REPLACE_VIA_DASHBOARD' then
    return 0;
  end if;

  -- Only the tail: unverified (missed) + needs_review (retry). Durable rehosted
  -- rows can't rot, so re-checking them is wasted work. Stalest first.
  for v_id in
    select id from products
    where is_active and (image_verified is null or image_verified is false)
    order by image_verified_at asc nulls first
    limit greatest(batch, 1)
  loop
    perform net.http_post(
      url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/verify-product-image',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_token),
      body    := jsonb_build_object('product_id', v_id, 'dry_run', false),
      timeout_milliseconds := 120000
    );
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

-- ── safe retire of genuinely-dead images ─────────────────────────────────────
-- Returns the count of retire candidates; deactivates them ONLY when the
-- killswitch is on. :blocked and :no_good are never retired.
create or replace function public.reconcile_retire_dead()
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_enforce boolean;
  v_n       int;
begin
  select count(*) into v_n
    from products
   where is_active
     and image_verify_note = 'needs_review:dead'
     and image_verified_at < now() - interval '3 days';

  v_enforce := coalesce((select value from app_settings where key = 'image_retire_enabled'), 'false') = 'true';

  if v_enforce and v_n > 0 then
    update products set is_active = false
     where is_active
       and image_verify_note = 'needs_review:dead'
       and image_verified_at < now() - interval '3 days';
  end if;

  return v_n;  -- candidates (retired if enforce on, else would-retire count)
end;
$function$;

-- ── review-queue snapshot (read-only, for admin / operator) ───────────────────
create or replace function public.image_review_queue()
returns table(kind text, n bigint)
language sql
stable
as $function$
  select 'dead'::text,        count(*) from products where is_active and image_verify_note = 'needs_review:dead'
  union all
  select 'blocked',           count(*) from products where is_active and image_verify_note = 'needs_review:blocked'
  union all
  select 'no_good',           count(*) from products where is_active and image_verify_note = 'needs_review:no_good'
  union all
  select 'non_apparel',       count(*) from products where is_active and lower(coalesce(type,'')) in
    ('art','plants','book','books','laptops','tech','decor','candles','home fragrance',
     'kitchenware','laundry detergent','mouse','earbuds','stationery','other');
$function$;

-- ── crons (both internally gated; run but no-op until enabled) ────────────────
select cron.schedule('image-reconcile-verify', '0 */6 * * *', $$select public.reconcile_verify_images(25)$$);
select cron.schedule('image-reconcile-retire', '30 7 * * *',  $$select public.reconcile_retire_dead()$$);
