-- Make looks.source_generation_id a real FK with ON DELETE CASCADE so
-- "the look is one row, and that row is gone everywhere when it's
-- deleted" actually holds at the schema level instead of relying on
-- app code to remember to delete both sides.
--
-- Two effects:
--   1. Deleting a user_generations row auto-deletes the looks row that
--      was promoted from it (along with looks_creative / look_products
--      via their existing CASCADE FKs on look_id). So the user-side
--      "delete from My Looks" propagates to the curated catalog.
--   2. The admin Delete button on the Published tab can simply DELETE
--      the looks row; we then DELETE the source generation in app code
--      to make the inverse trip too. The migration only enforces the
--      gen → look direction; the other direction is purely app-driven
--      because we don't want every admin look (including hand-curated
--      seed rows that point at no generation) to require a matching
--      generation.

alter table public.looks
  drop constraint if exists looks_source_generation_id_fkey;

alter table public.looks
  add constraint looks_source_generation_id_fkey
  foreign key (source_generation_id)
  references public.user_generations(id)
  on delete cascade
  not valid;

alter table public.looks
  validate constraint looks_source_generation_id_fkey;
