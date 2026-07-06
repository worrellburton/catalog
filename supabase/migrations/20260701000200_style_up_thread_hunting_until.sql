-- Persistent "web hunt in progress" marker so the working indicator survives a
-- refresh / navigation, and the hunt itself runs server-side (in style-up-chat).
alter table public.style_up_threads
  add column if not exists hunting_until timestamptz;
