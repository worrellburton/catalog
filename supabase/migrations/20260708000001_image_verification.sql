-- Image verification + re-host foundation (Phase 1a — ADDITIVE ONLY).
--
-- Adds the columns verify-product-image writes, a permanent backup column for
-- the pre-prune gallery, and a public storage bucket to re-host product images
-- into (so they stop rotting when merchant/gstatic/serpapi hotlinks expire).
--
-- NOTHING here is wired into the pipeline yet: the post-scrape trigger still
-- calls pick-primary-image, and product_ready_for_feed is unchanged. This
-- migration is safe to apply on its own and reverses cleanly (drop columns +
-- delete bucket). No existing row is modified.

alter table public.products
  add column if not exists image_verified     boolean,
  add column if not exists image_verify_score real,
  add column if not exists image_verified_at  timestamptz,
  add column if not exists image_verify_note   text,
  -- One-time snapshot of the ORIGINAL images[] before verify prunes it.
  -- Set once (only when null) so the earliest gallery is always recoverable.
  add column if not exists images_raw          jsonb;

comment on column public.products.image_verified is
  'Set by verify-product-image: true = primary is a confirmed real photo of this product. NULL = not yet checked (grandfathered by product_ready_for_feed).';
comment on column public.products.images_raw is
  'Backup of images[] captured the first time verify-product-image pruned the gallery. Restore path for an over-eager prune.';

-- Public bucket to re-host verified product images into. Service role writes;
-- anyone reads (product images are public in the feed already).
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- Public read for the new bucket (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'product-images public read'
  ) then
    create policy "product-images public read"
      on storage.objects for select
      using (bucket_id = 'product-images');
  end if;
end $$;
