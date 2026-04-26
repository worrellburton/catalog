-- 048: Drop product_ads + legacy looks creative columns.
--
-- Cutover follow-up to 045–047. By the time this runs:
--   • Modal worker reads/writes product_creative (worker rewrite shipped in
--     91ad408)
--   • The app exclusively reads looks.* via looks_creative for video; admin
--     manage-looks no longer accepts looks.thumbnail_url and the catalog
--     assemble flow no longer writes ai_assembled / assembly_prompt
--   • product_creative carries every row that used to live on product_ads
--     (197/197 verified in Phase 5)

-- ── product_ads ─────────────────────────────────────────────────────────
-- Dropping the table cascades the 016 trigger and the 015 RLS policies.
drop trigger  if exists trg_product_ads_notify_modal      on product_ads;
drop function if exists notify_modal_generate_ad()         cascade;
drop function if exists increment_ad_impressions(uuid)     cascade;
drop function if exists increment_ad_clicks(uuid)          cascade;
drop table    if exists product_ads                        cascade;

-- ── looks: legacy creative columns ──────────────────────────────────────
-- Video + thumbnail live on looks_creative now (see 045). assembly_prompt
-- and ai_assembled were only written by the old AI-assemble flow; nothing
-- read them.
alter table looks
  drop column if exists video_path,
  drop column if exists thumbnail_url,
  drop column if exists assembly_prompt,
  drop column if exists ai_assembled;
