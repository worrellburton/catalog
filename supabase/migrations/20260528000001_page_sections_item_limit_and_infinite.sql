-- Per-section configuration columns for /admin/pages editor.
-- item_limit caps how many items the section renders (null = use
-- the section's hard-coded default). infinite flips the section
-- into an infinite-scroll feed; when true, item_limit becomes
-- an initial page size rather than a hard cap.
alter table public.page_sections
  add column if not exists item_limit int,
  add column if not exists infinite   boolean not null default false;

update public.page_sections set infinite = true
 where (page = 'product' and section_key = 'you-might-also-like')
   and infinite is distinct from true;
