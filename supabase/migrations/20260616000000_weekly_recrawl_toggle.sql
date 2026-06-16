-- Weekly site re-crawl kill-switch.
--
-- The Modal cron `weekly_recrawl_sites` (agents/site-crawler/modal_app.py,
-- schedule "0 6 * * 1" = every Monday 06:00 UTC) re-queues a fresh crawl for
-- every site that has ever completed one. Previously it ran unconditionally,
-- which surprised operators ("we only crawled once but there are weekly runs").
--
-- This flag lets the Indexers → Full Site admin UI pause/resume that cron
-- without a redeploy. The cron reads it via service-role and fails CLOSED:
-- it only runs when the value is exactly 'true'. Seeded paused.

insert into public.app_settings (key, value, updated_at)
values ('weekly_recrawl_enabled', 'false', now())
on conflict (key) do nothing;
