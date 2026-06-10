-- 074 - "How did I do?" feedback on user generations.
--
-- After a generation completes, the user gets a 3-button feedback bar:
--   1. "It looks great!" - expands to keep-private / publish-to-catalog
--   2. "Umm... this is not it" - expands to a reason input
--   3. "Don't like, delete" - hard-deletes the row (existing flow)
--
-- We persist:
--   is_published    - true when the user picks publish-to-catalog. The
--                     consumer feed query can later filter on this to
--                     surface user-generated looks alongside admin
--                     creatives.
--   feedback_kind   - 'love' | 'off' | null. The button the user
--                     pressed; 'love' = looks great, 'off' = this is
--                     not it. Delete doesn't write a feedback row
--                     because the row is gone.
--   feedback_reason - free text the user typed when picking "off".
--
-- Indexed on (user_id, is_published) so per-user "my published looks"
-- queries are cheap.

alter table user_generations
  add column if not exists is_published boolean not null default false;

alter table user_generations
  add column if not exists feedback_kind text
    check (feedback_kind in ('love', 'off') or feedback_kind is null);

alter table user_generations
  add column if not exists feedback_reason text;

create index if not exists user_generations_published_idx
  on user_generations (user_id, is_published, created_at desc)
  where is_published = true;

comment on column user_generations.is_published is
  'True when the user opted to publish this look to the catalog feed.';
comment on column user_generations.feedback_kind is
  'love = user said it looks great; off = user said this is not it. Null until they answer.';
