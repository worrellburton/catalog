-- profiles.country — ISO 3166-1 alpha-2, uppercased.
--
-- Powers the user brain's drill-by-country (/admin/governance/users).
-- Captured client-side at sign-in (services/auth.ts: timezone → region,
-- falling back to navigator.language) the same way gender inference
-- runs; backfilled here from lens_searches for users who already have
-- a search-geo signal.

alter table public.profiles add column if not exists country text;

update public.profiles p
set country = upper(s.country)
from (
  select user_id, country,
         row_number() over (partition by user_id order by count(*) desc) as rn
  from public.lens_searches
  where user_id is not null and country is not null
  group by user_id, country
) s
where s.rn = 1 and s.user_id = p.id and p.country is null;
