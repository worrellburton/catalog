-- Add a "Similar looks" (a.k.a. "More like this") section to the Looks
-- page config so it shows up in /admin/pages alongside the others and
-- can be toggled / reordered / count-capped. The LookOverlay already
-- renders this rail (feedSections.looksLikeThis); this row just makes it
-- a first-class, admin-controllable section.

insert into public.page_sections (page, section_key, label, description, sort_order, enabled) values
  ('looks', 'similar', 'Similar looks', 'Looks that share garments with this one (“More like this”), with a Popular fallback.', 5, true)
on conflict (page, section_key) do nothing;
