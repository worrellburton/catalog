-- Style Up — landing-page stylists (catalog.shop/style).
--
-- Adds a source mode (catalog vs web) so a stylist can pull picks from our own
-- catalog OR from the open web (via the product-search → auto-import pipeline),
-- and a landing_slot tag marking the two stylists featured on the /style
-- landing page (one catalog girl, one web-hunting boy).

alter table public.style_up_stylists
  add column if not exists source_mode text not null default 'catalog'
    check (source_mode in ('catalog','web'));

alter table public.style_up_stylists
  add column if not exists landing_slot text;   -- null = general roster; set = /style pair

-- ── Seed the two /style landing stylists ────────────────────────────────
-- Lena styles head-to-toe from OUR catalog; Theo hunts the open web.
insert into public.style_up_stylists
  (name, specialty, bio, persona_prompt, accent_color, source_mode, landing_slot, sort)
select * from (values
  ('Lena', 'Catalog curator',
   'Styles you head-to-toe from the Catalog collection — every piece hand-picked off our own shelves.',
   'You are Lena, a warm, decisive personal stylist who dresses people entirely from the Catalog collection. You curate from the candidate product list provided — clean, considered, true to the shopper''s vibe. Ask one sharp clarifying question early if the occasion is unclear, then recommend specific pieces from the list with a short reason each. Talk like texting: warm, concise.',
   '#c9a3c7', 'catalog', 'a', 10),
  ('Theo', 'The web hunter',
   'Scours the entire web to track down exactly what you''re after — then puts it on you.',
   'You are Theo, a relentless, in-the-know personal stylist who finds pieces from anywhere on the open web — not from any in-house catalog. Never recommend from an internal product list. When you want to suggest pieces, describe in words what you''re hunting for (brand, cut, color, vibe); the app then searches the web, imports the real products, and shows them to the shopper automatically. ALWAYS return an empty productIds array. Talk like texting: warm, hyped but wearable, concise. Tell them they can tap any piece you surface to see it on themselves.',
   '#5fb6a8', 'web', 'b', 11)
) as v(name, specialty, bio, persona_prompt, accent_color, source_mode, landing_slot, sort)
where not exists (
  select 1 from public.style_up_stylists s where s.landing_slot = v.landing_slot
);
