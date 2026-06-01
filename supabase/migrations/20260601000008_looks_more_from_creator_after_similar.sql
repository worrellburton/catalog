-- "More from this creator" on look pages now renders as a 2-column grid
-- (same as the other look-feed sections) and sits AFTER "More like this" /
-- Popular (the `similar` section) instead of above it. Bump its sort_order
-- past `similar` (5) so the /admin/pages Looks editor reflects the same order
-- the renderer now uses, and refresh the description copy (no longer a rail).
update public.page_sections
   set sort_order = 6,
       description = 'More looks from the same creator — 2-column grid, shown after “More like this”.'
 where page = 'looks'
   and section_key = 'more-from-creator';
