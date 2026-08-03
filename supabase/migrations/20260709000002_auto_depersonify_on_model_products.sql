-- When the verify pass determines a product has NO person-free image
-- (primary_image_person_free = false), auto-generate a de-personed packshot so
-- the try-on video model can use it. Fires once per product: the guard skips
-- any product that already has a de-personed candidate staged in images_raw.
-- depersonify-product-image itself re-runs verify to promote the packshot, so
-- a successful run flips the flag to true and this stops firing; a failed/bad
-- run leaves the 'depersonified' marker in images_raw, which also stops it.
create or replace function public.notify_depersonify_on_model()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_token text;
begin
  -- Only act when the product just landed on-model-only (no person-free image).
  if new.primary_image_person_free is distinct from false then
    return new;
  end if;
  -- Once-per-product: skip if we've already staged a de-personed packshot.
  if new.images_raw is not null and new.images_raw::text like '%depersonified%' then
    return new;
  end if;
  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'embed_entity_service_key' limit 1;
  if v_token is null or v_token = 'PLACEHOLDER_REPLACE_VIA_DASHBOARD' then
    return new;
  end if;
  perform net.http_post(
    url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/depersonify-product-image',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_token),
    body    := jsonb_build_object('product_id', new.id),
    timeout_milliseconds := 120000
  );
  return new;
end;
$function$;

drop trigger if exists trg_depersonify_on_model on public.products;
create trigger trg_depersonify_on_model
  after update of primary_image_person_free on public.products
  for each row execute function public.notify_depersonify_on_model();
