-- Migration 083: Embed all products with complete data, regardless of is_active status
--
-- CHANGE: Remove the is_active check from notify_embed_product() so that:
--   • ALL products with name + url get embedded when inserted/updated
--   • Search RPC still filters is_active=true (only active shown in results)
--   • But inactive products are embedded and ready to go live instantly
--
-- BACKFILL: Trigger embedding for the 759 inactive products via pg_net.

-- ── 1. Update trigger function to embed ALL products with data ─────────────
create or replace function public.notify_embed_product()
returns trigger
language plpgsql
security definer
as $$
declare
  v_token text;
begin
  -- Only require that the product has a name (minimal data quality gate).
  -- Removed is_active check — embed everything so products are search-ready
  -- the moment they flip to active.
  if NEW.name is null or NEW.name = '' then
    return NEW;
  end if;

  select decrypted_secret into v_token
    from vault.decrypted_secrets
   where name = 'embed_entity_service_key'
   limit 1;

  if v_token is null or v_token = 'PLACEHOLDER_REPLACE_VIA_DASHBOARD' then
    return NEW;
  end if;

  perform net.http_post(
    url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/embed-product',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body    := jsonb_build_object('id', NEW.id)
  );
  return NEW;
end;
$$;

comment on function public.notify_embed_product() is
  'Fires embed-product whenever a product row with a name is inserted/updated. Embeds all products (active or not) so they are search-ready when activated.';

-- ── 2. Backfill inactive products ──────────────────────────────────────────
-- Dispatch embed-product for all 759 inactive products (name not null).
-- Uses the same vault secret + pg_net pattern as the trigger.

do $$
declare
  v_token text;
  v_row record;
  v_count int := 0;
begin
  select decrypted_secret into v_token
    from vault.decrypted_secrets
   where name = 'embed_entity_service_key'
   limit 1;

  if v_token is null or v_token = 'PLACEHOLDER_REPLACE_VIA_DASHBOARD' then
    raise notice 'Skipping backfill: embed_entity_service_key not set in vault';
    return;
  end if;

  for v_row in
    select id
      from public.products
     where is_active = false
       and embedding is null
       and name is not null
       and name != ''
     order by created_at desc
  loop
    perform net.http_post(
      url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/embed-product',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_token
      ),
      body    := jsonb_build_object('id', v_row.id)
    );
    v_count := v_count + 1;

    -- Log progress every 100 rows
    if v_count % 100 = 0 then
      raise notice 'Backfill progress: % products queued', v_count;
    end if;
  end loop;

  raise notice 'Backfill complete: % inactive products queued for embedding', v_count;
end;
$$;
