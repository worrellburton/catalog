-- 047: Add 'queued' to product_creative status check
--
-- Migration 045 mirrored 015's original status set, but later changes to
-- product_ads added a 'queued' tier used by createBatchAds()/promoteQueuedAds()
-- to throttle Modal worker concurrency. The Phase 8 service rename relies on
-- writing 'queued' rows, so allow it on product_creative too.

alter table product_creative drop constraint if exists product_creative_status_check;

alter table product_creative
  add constraint product_creative_status_check
  check (status in ('queued','pending','generating','done','failed','live','paused'));
