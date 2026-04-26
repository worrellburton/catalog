-- 046: product_creative Modal webhook
--
-- Mirrors the trigger from 016_product_ads_webhook on the new product_creative
-- table. Fires a Modal webhook whenever a row is inserted with status='pending'
-- so the worker picks it up and renders the video.
--
-- Ships alongside the Phase 7 Modal worker rewrite that switches reads to
-- product_creative + the renamed `model` column.

create extension if not exists pg_net;

create or replace function notify_modal_generate_creative()
returns trigger
language plpgsql
security definer
as $$
begin
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

drop trigger if exists trg_product_creative_notify_modal on product_creative;

create trigger trg_product_creative_notify_modal
  after insert on product_creative
  for each row
  execute function notify_modal_generate_creative();
