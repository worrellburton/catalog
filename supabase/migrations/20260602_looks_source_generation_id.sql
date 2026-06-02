-- Link a curated `looks` row back to the `user_generations` it was promoted
-- from. Before this column, the admin Publish flow created a new looks row
-- every time it ran for a given generation — and the Unpublished tab kept
-- listing the generation (it reads from user_generations directly), so a
-- second click of Publish silently produced a duplicate. Now we treat a
-- generation as having AT MOST ONE looks row and toggle status='live' ↔
-- status='draft' instead of inserting again.
--
-- Backfill: any existing draft/live look with the legacy "Promoted from
-- generation <uuid>" description pattern gets its source_generation_id
-- backfilled from the description so the dedupe rule applies retroactively.
-- Without this, historical orphan drafts would each spawn a duplicate the
-- first time someone re-clicks Publish.

alter table public.looks
  add column if not exists source_generation_id uuid;

-- Soft FK so we can detach the generation later (admin delete of the source
-- gen) without cascading-delete the look. Indexed to keep the find-or-create
-- lookup O(1).
create index if not exists looks_source_generation_id_idx
  on public.looks (source_generation_id)
  where source_generation_id is not null;

-- One look per generation. Partial unique so legacy NULL rows aren't covered.
create unique index if not exists looks_source_generation_id_unique
  on public.looks (source_generation_id)
  where source_generation_id is not null;

-- Backfill from the description column. Older publishes stamped the source
-- generation id into the description ("Promoted from generation <uuid>")
-- before we had a dedicated column — pull it back out so dedup works on
-- pre-migration rows too.
update public.looks
   set source_generation_id = (
     regexp_match(description, 'Promoted from generation ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')
   )[1]::uuid
 where source_generation_id is null
   and description ~ 'Promoted from generation [0-9a-f-]{36}'
   -- If multiple looks point to the same generation (the duplicate bug),
   -- keep only the newest one — older duplicates stay un-backfilled and
   -- can be cleaned up manually if desired.
   and id = (
     select l2.id from public.looks l2
     where l2.description like 'Promoted from generation%'
       and (regexp_match(l2.description, 'Promoted from generation ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'))[1]
         = (regexp_match(public.looks.description, 'Promoted from generation ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'))[1]
     order by l2.created_at desc
     limit 1
   );

comment on column public.looks.source_generation_id is
  'When this look was promoted from a user_generation via the admin Publish flow, the source generation id. Used to dedupe republishes: a second Publish click finds the existing row and flips status="live" instead of inserting again. NULL on hand-curated seed looks and looks created directly via /admin without a generation behind them.';
