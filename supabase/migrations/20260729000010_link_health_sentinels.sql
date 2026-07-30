-- F7: distinguish SSRF rejects / timeouts from genuine dead links.
--
-- check-product-links previously recorded url_status=0 for THREE different
-- situations (SSRF-blocked, DNS/timeout failure, and "no other bucket fit"),
-- and link_health_summary() bucketed all of them as 'dead' alongside real
-- 404s. A DNS hiccup or a blocked-by-policy redirect target then read as a
-- dead product until the next daily pass. 416 (Range not satisfiable — a
-- legitimate response to our own `Range: bytes=0-2048` header) also bucketed
-- as dead.
--
-- The edge function (supabase/functions/check-product-links/index.ts) now
-- writes distinct sentinels instead of 0:
--   -1 = blocked_by_policy (SSRF guard rejected the URL or a redirect hop)
--   -2 = unreachable       (timeout, DNS failure, redirect dead-end/cap)
--   0  = intentionally left unused
--
-- This migration only updates link_health_summary() to bucket the new
-- sentinels (and 416) correctly. url_status is already `smallint`, which
-- comfortably holds negative values — no column change needed.
create or replace function public.link_health_summary()
returns table(bucket text, n bigint) language sql stable as $$
  select case
           when url_status is null                    then 'unchecked'
           when url_status = -1                        then 'blocked_by_policy'
           when url_status = -2                        then 'unreachable'
           when url_status between 200 and 299        then 'live'
           when url_status = 416                       then 'live'
           when url_status = 403                      then 'bot_blocked'
           else 'dead'
         end, count(*)
    from public.products where is_active group by 1;
$$;
