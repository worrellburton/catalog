-- 051_user_generations_display_name.sql
-- Adds a free-text display_name column to user_generations so each
-- look can have a Claude-generated 2-4 word name shown on its card
-- (e.g. "Linen Sunset", "Studio Tailored") instead of the
-- generic style preset label like "Commercial".

alter table public.user_generations
  add column if not exists display_name text;
