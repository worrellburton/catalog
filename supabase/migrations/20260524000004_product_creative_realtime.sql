-- Enable Supabase Realtime for product_creative so the admin layout
-- can subscribe to row changes instead of polling every 5 seconds.
-- See app/routes/admin/route.tsx — the channel listens for any
-- postgres_changes event and re-polls only when a row actually moves.
alter publication supabase_realtime add table public.product_creative;
