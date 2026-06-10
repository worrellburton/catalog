-- Auto-generate a poster frame AND a unique description for every look, the
-- moment it's made — no admin/browser involvement.
--
-- Chain:
--   1. A look's primary creative is inserted with a video_url (any path:
--      promote-from-generation, CreateLookV2 upload, server-side AI pipeline).
--   2. notify_generate_look_poster() fires the Modal look-poster endpoint,
--      which extracts the clip's first frame (native 3:4) and writes
--      looks_creative.thumbnail_url. (Mirrors trg_products_generate_primary_poster.)
--   3. Once thumbnail_url is set, notify_generate_look_description() calls the
--      look-description edge function, which shows Gemini the real poster frame
--      + the look's products and writes a unique blurb to look_descriptions.
--
-- Both are SECURITY DEFINER + pg_net, fire-and-forget. The description trigger
-- reuses the embed_entity_service_key vault secret (same one migration 065 uses
-- to call embed-entity) for the function's Authorization bearer.

-- ── 1. Poster: Modal look-poster on a new primary video without a poster ──────
create or replace function public.notify_generate_look_poster()
returns trigger
language plpgsql
security definer
as $$
begin
  if NEW.is_primary
     and NEW.video_url is not null
     and NEW.thumbnail_url is null
     and (TG_OP = 'INSERT' or NEW.video_url is distinct from OLD.video_url)
  then
    perform net.http_post(
      url     := 'https://catalog--generate-look-poster.modal.run',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := jsonb_build_object('record', row_to_json(NEW))
    );
  end if;
  return NEW;
end;
$$;

comment on function public.notify_generate_look_poster() is
  'Fires the Modal generate-look-poster endpoint whenever a primary looks_creative gets a video but no poster, so every look gets its own first-frame thumbnail automatically.';

drop trigger if exists trg_looks_creative_generate_poster on public.looks_creative;
create trigger trg_looks_creative_generate_poster
  after insert or update of video_url on public.looks_creative
  for each row
  execute function public.notify_generate_look_poster();

-- ── 2. Description: look-description edge fn once the poster frame exists ──────
create or replace function public.notify_generate_look_description()
returns trigger
language plpgsql
security definer
as $$
declare
  v_token text;
begin
  -- Fire when a primary creative has its poster frame (so Gemini analyzes the
  -- look's own image, not a product packshot) and the look isn't described yet.
  if NEW.is_primary
     and NEW.video_url is not null
     and NEW.thumbnail_url is not null
  then
    if exists (select 1 from public.look_descriptions where look_id = NEW.look_id) then
      return NEW;
    end if;

    select decrypted_secret into v_token
      from vault.decrypted_secrets
     where name = 'embed_entity_service_key'
     limit 1;
    if v_token is null or v_token = 'PLACEHOLDER_REPLACE_VIA_DASHBOARD' then
      return NEW;  -- secret not set; on-view client generation still covers it
    end if;

    perform net.http_post(
      url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/look-description',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_token
      ),
      body    := jsonb_build_object('lookId', NEW.look_id)
    );
  end if;
  return NEW;
end;
$$;

comment on function public.notify_generate_look_description() is
  'Calls the look-description edge function (Gemini) once a primary looks_creative has a poster frame, so every look gets a unique, image-grounded description automatically. Reuses the embed_entity_service_key vault secret for auth.';

drop trigger if exists trg_looks_creative_generate_description on public.looks_creative;
create trigger trg_looks_creative_generate_description
  after insert or update of thumbnail_url on public.looks_creative
  for each row
  execute function public.notify_generate_look_description();
