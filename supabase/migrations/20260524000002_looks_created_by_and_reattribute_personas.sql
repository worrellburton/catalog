-- Rule: looks that creators own belong to creators, and show on the
-- creator's profile (/c/<handle>). Admin-generated rows currently
-- attribute to the admin (Robert) via looks.user_id, with the persona
-- buried in the title. This migration:
--   1. Adds looks.created_by to preserve "which admin ran generate"
--   2. Seeds 5 creator rows for the personas referenced in titles
--   3. Moves user_id → persona profile and sets creator_handle so
--      each look surfaces on the right /c/<handle> page

alter table public.looks add column if not exists created_by uuid references auth.users(id) on delete set null;
update public.looks set created_by = user_id where created_by is null;

-- Seed creators table. Handles match the slugified form the /c/<handle>
-- route uses. is_ai matches the underlying profile.
insert into public.creators (id, handle, display_name, is_ai) values
  ('ef72faf0-583e-431d-85e4-3f9cf67372b7', 'janehamilton',     'janehamilton',     true),
  ('24eabfd5-9b2d-4b60-8671-5dc606573091', 'avagreen',         'avagreen',         true),
  ('b506c017-4bc6-478c-8ca4-d6d766765574', 'taylor-phillips',  'Taylor Phillips',  false),
  ('8139187d-cbfd-47d3-98c8-059194f2b884', 'samir-maikap',     'Samir Maikap',     false),
  ('27729261-5954-4dfd-aa8a-232b2196458b', 'robert-burton',    'Robert Burton',    false)
on conflict (id) do update set
  handle = excluded.handle,
  display_name = excluded.display_name,
  is_ai = excluded.is_ai;

-- Move user_id and set creator_handle in one update per persona. Title
-- pattern uses the unicode right-single-quote (U+2019) the generator
-- emits, plus the ASCII apostrophe just in case.
update public.looks set user_id = 'ef72faf0-583e-431d-85e4-3f9cf67372b7', creator_handle = 'janehamilton'
  where created_by = '27729261-5954-4dfd-aa8a-232b2196458b'
    and (title ilike 'janehamilton''s%' or title ilike E'janehamilton’s%');

update public.looks set user_id = '24eabfd5-9b2d-4b60-8671-5dc606573091', creator_handle = 'avagreen'
  where created_by = '27729261-5954-4dfd-aa8a-232b2196458b'
    and (title ilike 'avagreen''s%' or title ilike E'avagreen’s%');

update public.looks set user_id = 'b506c017-4bc6-478c-8ca4-d6d766765574', creator_handle = 'taylor-phillips'
  where created_by = '27729261-5954-4dfd-aa8a-232b2196458b'
    and (title ilike 'Taylor Phillips''s%' or title ilike E'Taylor Phillips’s%');

update public.looks set user_id = '8139187d-cbfd-47d3-98c8-059194f2b884', creator_handle = 'samir-maikap'
  where created_by = '27729261-5954-4dfd-aa8a-232b2196458b'
    and (title ilike 'Samir Maikap''s%' or title ilike E'Samir Maikap’s%');

-- Robert's own looks stay where they are; just set creator_handle.
update public.looks set creator_handle = 'robert-burton'
  where user_id = '27729261-5954-4dfd-aa8a-232b2196458b'
    and (title ilike 'Robert Burton''s%' or title ilike E'Robert Burton’s%')
    and creator_handle is null;
