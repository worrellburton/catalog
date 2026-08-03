-- Phase 1c + 2: route the post-scrape image step through verify-product-image
-- (verify + re-host, superset of pick-primary), and gate the seeding-activation
-- feed check on verification.
--
-- 1c: new trigger trg_products_auto_verify_image replaces trg_products_auto_pick
--     _primary. Same firing columns (images, image_url, scrape_status) and the
--     SAME idempotency guard (skip if primary_image_picked_at is set) — which
--     also prevents recursion: verify's good-path write sets picked_at, so the
--     re-fire no-ops; the zero-good path writes none of the firing columns, so it
--     never re-fires. pick-primary-image (fn + notify_pick_primary_image) is left
--     intact for the /admin/data manual buttons.
--
-- 2:  product_ready_for_feed gains `image_verified is not false` — NULL (not yet
--     checked) is grandfathered through, only an explicit false (needs_review)
--     blocks. This gate is used ONLY by run_seeding_activation (currently off) and
--     seed-run; it does NOT re-gate already-active products, so the live feed is
--     unaffected.

-- ── 1c ──────────────────────────────────────────────────────────────────────
create or replace function public.notify_verify_product_image()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_token text;
begin
  -- Idempotency + recursion guard: skip if a primary was already picked/verified.
  if new.primary_image_picked_at is not null then
    return new;
  end if;

  -- Need at least one candidate image.
  if (new.images is null or jsonb_array_length(new.images) = 0)
     and (new.image_url is null or length(new.image_url) = 0) then
    return new;
  end if;

  select decrypted_secret into v_token
    from vault.decrypted_secrets
   where name = 'embed_entity_service_key'
   limit 1;

  -- Skip silently if the service key isn't populated (the /admin/data sweep or
  -- the reconciler will catch the row later).
  if v_token is null or v_token = 'PLACEHOLDER_REPLACE_VIA_DASHBOARD' then
    return new;
  end if;

  perform net.http_post(
    url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/verify-product-image',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body    := jsonb_build_object('product_id', new.id, 'dry_run', false),
    timeout_milliseconds := 120000
  );

  return new;
end;
$function$;

drop trigger if exists trg_products_auto_pick_primary on public.products;
drop trigger if exists trg_products_auto_verify_image on public.products;

create trigger trg_products_auto_verify_image
  after insert or update of images, image_url, scrape_status
  on public.products
  for each row
  execute function public.notify_verify_product_image();

-- ── 2 ──────────────────────────────────────────────────────────────────────
create or replace function public.product_ready_for_feed(prod public.products)
returns boolean
language sql
stable
as $function$
  select
    (
      (prod.image_url is not null and btrim(prod.image_url) <> '')
      or (prod.images is not null and jsonb_array_length(prod.images) > 0)
      or prod.primary_image_url is not null
    )
    and (prod.image_verified is not false)  -- grandfather NULL, block needs_review
    and
    (
      case
        when prod.styling_metadata is null then false
        when prod.styling_metadata -> 'occasion' is null then false
        when jsonb_typeof(prod.styling_metadata -> 'occasion') = 'array'
          then jsonb_array_length(prod.styling_metadata -> 'occasion') > 0
        when jsonb_typeof(prod.styling_metadata -> 'occasion') = 'string'
          then length(btrim(prod.styling_metadata ->> 'occasion')) > 0
        else false
      end
    );
$function$;
