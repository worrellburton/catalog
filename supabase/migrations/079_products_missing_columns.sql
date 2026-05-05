-- Products columns that were added directly on cloud but never captured in a migration
alter table public.products
  add column if not exists last_refreshed_at timestamptz,
  add column if not exists previous_price text,
  add column if not exists display_name text,
  add column if not exists hook_copy text,
  add column if not exists rewritten_at timestamptz;

-- image_missing_reason exists locally (migration 072) but is absent from cloud —
-- ensure it exists on both sides safely
alter table public.products
  add column if not exists image_missing_reason text;
