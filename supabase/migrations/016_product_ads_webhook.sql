-- Migration: 016_product_ads_webhook
-- Creates a trigger that fires a Modal webhook whenever a product_ads row is
-- inserted with status = 'pending'. Uses pg_net (built into Supabase) for the
-- async HTTP POST so the INSERT is not blocked.

-- Enable pg_net extension (no-op if already enabled)
create extension if not exists pg_net;

-- ── Trigger function ────────────────────────────────────────────────────────
create or replace function notify_modal_generate_ad()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Only fire for pending rows (default on insert)
  if NEW.status = 'pending' then
    perform net.http_post(
      url     := 'https://catalog--generate-ad.modal.run',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := jsonb_build_object('record', row_to_json(NEW))
    );
  end if;
  return NEW;
end;
$$;

-- ── Trigger ─────────────────────────────────────────────────────────────────
drop trigger if exists trg_product_ads_notify_modal on product_ads;

create trigger trg_product_ads_notify_modal
  after insert on product_ads
  for each row
  execute function notify_modal_generate_ad();
