-- Bulk impression increment for the consumer feed.
--
-- The feed pings one impression RPC per creative as each card crosses the
-- pre-viewport band — dozens of separate Supabase requests per scroll session,
-- every one a cellular-radio wakeup on mobile. This collapses a whole flush
-- batch into ONE request.
--
-- Mirrors increment_product_creative_impressions (045_creative_tables.sql)
-- exactly — same table, same column — generalised from `= creative_id` to
-- `= any(creative_ids)`, so it's one atomic UPDATE instead of N round-trips.
--
-- The client (product-creative.ts → flushImpressions) calls this once per ~1s
-- flush and falls back to the per-id RPC when it isn't deployed, so shipping
-- the client ahead of this migration is safe and never double-counts.
create or replace function increment_product_creative_impressions_bulk(creative_ids uuid[])
returns void language plpgsql security definer as $$
begin
  update product_creative set impressions = impressions + 1 where id = any(creative_ids);
end;
$$;
