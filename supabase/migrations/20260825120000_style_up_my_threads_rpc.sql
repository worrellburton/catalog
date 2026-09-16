-- One round trip for the Style app's conversation list.
--
-- fetchMyThreads() was three serial queries, and the middle one pulled EVERY
-- message in EVERY thread (no bound) just to keep the newest one per thread for
-- a one-line preview. On the home surface that was the slowest thing on screen,
-- and it re-ran on a 6s poll.
--
-- security INVOKER (the default) on purpose: RLS on style_up_threads /
-- style_up_messages / user_generations still applies exactly as it would to the
-- client's own selects. The auth.uid() filter is belt-and-braces, and it takes
-- no user id parameter so a caller cannot ask for somebody else's threads.
create or replace function public.style_up_my_threads()
returns table (
  thread_id uuid,
  last_message_at timestamptz,
  hunting_until timestamptz,
  stylist jsonb,
  last_sender text,
  last_kind text,
  last_body text,
  gen_status text,
  gen_created_at timestamptz,
  gen_duration_seconds int
)
language sql
stable
security invoker
set search_path = public
as $$
  with mine as (
    select th.id, th.last_message_at, th.hunting_until, th.stylist_id
    from style_up_threads th
    where th.shopper_user_id = auth.uid()
  ),
  last_msg as (
    -- DISTINCT ON keeps only the newest message per thread, so the whole
    -- transcript never leaves the database.
    select distinct on (m.thread_id)
           m.thread_id, m.sender, m.kind, m.body, m.render_generation_id
    from style_up_messages m
    where m.thread_id in (select id from mine)
    order by m.thread_id, m.created_at desc
  )
  select
    mine.id,
    mine.last_message_at,
    mine.hunting_until,
    jsonb_build_object(
      'id', s.id, 'name', s.name, 'avatar_url', s.avatar_url,
      'specialty', s.specialty, 'bio', s.bio, 'city', s.city, 'age', s.age,
      'accent_color', s.accent_color, 'source_mode', s.source_mode,
      'landing_slot', s.landing_slot, 'favorite_brands', s.favorite_brands,
      'is_human', s.is_human, 'gender_focus', s.gender_focus
    ),
    lm.sender,
    lm.kind,
    lm.body,
    g.status,
    g.created_at,
    g.duration_seconds
  from mine
  join style_up_stylists s on s.id = mine.stylist_id
  -- inner join: a thread with no messages is not shown in the list anyway.
  join last_msg lm on lm.thread_id = mine.id
  -- only when the newest message IS a render, matching the old batch lookup.
  left join user_generations g
    on lm.kind = 'render'
   and g.id = lm.render_generation_id
   and g.status not in ('done', 'failed')
  order by mine.last_message_at desc nulls last;
$$;

grant execute on function public.style_up_my_threads() to authenticated;
