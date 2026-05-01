-- 065: Auto-embed looks when a looks_creative row goes live.
--
-- Mirrors the product_creative trigger from migration 060. When a
-- looks_creative row transitions to status='live' and has a video_url,
-- this trigger calls embed-entity(entity_type='look', id=look_id) so the
-- parent looks row gets concept_doc + text_embedding populated immediately,
-- rather than waiting for the nightly search-backfill cron.
--
-- Why looks_creative → looks (not looks_creative itself):
--   The embed-entity function for entity_type='look' builds its concept from
--   the looks row + its tagged look_products, then writes back to
--   looks.{concept_doc, concept_facets, text_embedding, concept_at}.
--   looks_creative has no text_embedding column (only the 1024-dim visual
--   embedding column populated by the TwelveLabs pipeline).
--
-- Reuses the embed_entity_service_key vault secret created in migration 060.
-- If the secret is still a placeholder the trigger skips silently — fix it
-- at: https://supabase.com/dashboard/project/vtarjrnqvcqbhoclvcur/settings/vault

-- ── 1. Trigger function ─────────────────────────────────────────────────────
create or replace function notify_embed_look()
returns trigger
language plpgsql
security definer
as $$
declare
  v_token text;
begin
  -- Only fire when the creative is live, has a video, and the parent look
  -- hasn't been embedded yet (concept_at IS NULL on the looks row).
  -- We check looks.concept_at to avoid re-embedding on every status tweak
  -- once the look already has an embedding.
  if NEW.status = 'live'
     and NEW.video_url is not null
  then
    -- Skip if the parent look already has an embedding (idempotency guard).
    if exists (
      select 1 from looks
       where id = NEW.look_id
         and concept_at is not null
    ) then
      return NEW;
    end if;

    select decrypted_secret into v_token
      from vault.decrypted_secrets
     where name = 'embed_entity_service_key'
     limit 1;

    -- Skip silently if the secret hasn't been populated yet.
    -- The nightly backfill will catch the row.
    if v_token is null or v_token = 'PLACEHOLDER_REPLACE_VIA_DASHBOARD' then
      return NEW;
    end if;

    perform net.http_post(
      url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/embed-entity',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_token
      ),
      body    := jsonb_build_object(
        'id',          NEW.look_id,
        'entity_type', 'look',
        'force',       false
      )
    );
  end if;
  return NEW;
end;
$$;

comment on function notify_embed_look() is
  'Fires embed-entity(entity_type=look) for the parent looks row whenever a looks_creative goes live with a video_url and the look is not yet embedded. Wired by trg_looks_creative_auto_embed.';

-- ── 2. Trigger ──────────────────────────────────────────────────────────────
drop trigger if exists trg_looks_creative_auto_embed on looks_creative;

create trigger trg_looks_creative_auto_embed
  after insert or update of status, video_url
  on looks_creative
  for each row
  execute function notify_embed_look();
