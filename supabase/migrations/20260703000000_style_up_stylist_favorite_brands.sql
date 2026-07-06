-- Each stylist's favorite brands, shown as logo chips on the "Find a
-- stylist" picker (replacing the specialty tag line there). jsonb array of
-- { name, domain } — the domain drives the client-side logo lookup.
alter table style_up_stylists
  add column if not exists favorite_brands jsonb not null default '[]'::jsonb;

update style_up_stylists set favorite_brands = v.brands::jsonb
from (values
  ('Margot',   '[{"name":"The Row","domain":"therow.com"},{"name":"Totême","domain":"toteme-studio.com"},{"name":"Loro Piana","domain":"loropiana.com"}]'),
  ('Devon',    '[{"name":"Nike","domain":"nike.com"},{"name":"Stüssy","domain":"stussy.com"},{"name":"Salomon","domain":"salomon.com"}]'),
  ('Sofia',    '[{"name":"Reformation","domain":"thereformation.com"},{"name":"Cult Gaia","domain":"cultgaia.com"},{"name":"Zimmermann","domain":"zimmermann.com"}]'),
  ('Lena',     '[{"name":"James Perse","domain":"jamesperse.com"},{"name":"COS","domain":"cos.com"},{"name":"Arket","domain":"arket.com"}]'),
  ('Theo',     '[{"name":"Uniqlo","domain":"uniqlo.com"},{"name":"Carhartt","domain":"carhartt.com"},{"name":"New Balance","domain":"newbalance.com"}]'),
  ('Amara',    '[{"name":"Ganni","domain":"ganni.com"},{"name":"Farm Rio","domain":"farmrio.com"},{"name":"Marni","domain":"marni.com"}]'),
  ('Kenji',    '[{"name":"Issey Miyake","domain":"isseymiyake.com"},{"name":"Lemaire","domain":"lemaire.fr"},{"name":"Jil Sander","domain":"jilsander.com"}]'),
  ('Priya',    '[{"name":"Patagonia","domain":"patagonia.com"},{"name":"Veja","domain":"veja-store.com"},{"name":"Eileen Fisher","domain":"eileenfisher.com"}]'),
  ('Mateo',    '[{"name":"Massimo Dutti","domain":"massimodutti.com"},{"name":"Levi''s","domain":"levi.com"},{"name":"Sunspel","domain":"sunspel.com"}]'),
  ('Chloe',    '[{"name":"Sézane","domain":"sezane.com"},{"name":"Sandro","domain":"sandro-paris.com"},{"name":"A.P.C.","domain":"apc.fr"}]'),
  ('Isabella', '[{"name":"Valentino","domain":"valentino.com"},{"name":"Dolce & Gabbana","domain":"dolcegabbana.com"},{"name":"Versace","domain":"versace.com"}]'),
  ('Noah',     '[{"name":"Arc''teryx","domain":"arcteryx.com"},{"name":"The North Face","domain":"thenorthface.com"},{"name":"Snow Peak","domain":"snowpeak.com"}]'),
  ('Zara',     '[{"name":"Diesel","domain":"diesel.com"},{"name":"Marc Jacobs","domain":"marcjacobs.com"},{"name":"adidas","domain":"adidas.com"}]')
) as v(name, brands)
where style_up_stylists.name = v.name;
