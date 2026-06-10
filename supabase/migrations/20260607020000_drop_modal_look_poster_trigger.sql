-- Look posters are generated on our OWN codebase (client-side first-frame grab
-- in app/utils/video-poster.ts at look creation + the poster backfill), not on
-- Modal. Drop the Modal look-poster trigger added in 20260607010000 — we don't
-- need a server-side ffmpeg job for this.
--
-- The description trigger (trg_looks_creative_generate_description) stays: it
-- fires when thumbnail_url is set (by the client-side grab) and calls our own
-- look-description edge function. That's all on our infra, no Modal.

drop trigger if exists trg_looks_creative_generate_poster on public.looks_creative;
drop function if exists public.notify_generate_look_poster();
