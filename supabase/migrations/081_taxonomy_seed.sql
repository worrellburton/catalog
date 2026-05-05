-- 081: SEARCH_V3 — seed product_taxonomy synonyms + keywords for active types.
--
-- Phase B foundation: nl-search.loadTaxonomyExamples() reads this table and
-- injects per-type few-shot examples into Haiku's prompt. Once seeded, Haiku
-- learns the synonym → canonical mapping without any code change.
--
-- Source-of-truth note: this table also becomes the source for the static
-- fallback CATALOG_TYPE_SYNONYMS map once Phase B lands in TS. Keep it
-- in sync with query-analyzer.ts until the static map is removed.
--
-- Idempotent: uses upserts on (type) primary key. Safe to re-run.

insert into public.product_taxonomy (type, category, synonyms, keywords) values
  ('Top',        'fashion', array['shirt','tee','t-shirt','blouse','sweater','hoodie','knit','pullover','tank','polo'], 'shirt top upper blouse sweater knit'),
  ('Pants',      'fashion', array['pant','pants','jean','jeans','trouser','denim','legging','jogger','sweatpant'],     'pants bottom trouser denim jean'),
  ('Shorts',     'fashion', array['short','shorts','athletic short','running short'],                                    'shorts'),
  ('Skirt',      'fashion', array['skirt','midi skirt','maxi skirt','mini skirt'],                                       'skirt'),
  ('Dress',      'fashion', array['dress','gown','midi','maxi','mini dress','sundress'],                                 'dress gown'),
  ('Jacket',     'fashion', array['jacket','blazer','windbreaker','bomber','denim jacket'],                              'jacket blazer outerwear'),
  ('Coat',       'fashion', array['coat','overcoat','trench','parka','peacoat','puffer'],                                'coat overcoat winter'),
  ('Underwear',  'fashion', array['bra','bras','underwear','lingerie','brief','briefs','boxer','boxers','panties','thong'], 'underwear bra lingerie intimates'),
  ('Loungewear', 'fashion', array['loungewear','pajama','pajamas','pjs','sleepwear','robe'],                             'loungewear sleepwear pajama'),
  ('Activewear', 'fashion', array['activewear','workout','gym','athletic','athleisure','training'],                      'activewear athletic workout gym'),
  ('Swimwear',   'fashion', array['swimwear','swimsuit','bikini','trunks','board shorts'],                               'swimwear swimsuit beach'),
  ('Shoes',      'fashion', array['shoe','shoes','heel','heels','loafer','loafers','flat','flats','mule','mules','footwear'], 'shoe footwear leather'),
  ('Sneakers',   'fashion', array['sneaker','sneakers','trainer','trainers','runner','runners','kicks'],                 'sneaker shoe trainer runner'),
  ('Boots',      'fashion', array['boot','boots','chelsea','combat boot','ankle boot'],                                  'boot footwear leather'),
  ('Hat',        'fashion', array['hat','cap','caps','beanie','baseball cap','bucket hat','headwear'],                   'hat cap beanie headwear'),
  ('Bag',        'fashion', array['bag','purse','handbag','tote','backpack','crossbody'],                                'bag purse handbag tote'),
  ('Scarf',      'fashion', array['scarf','scarves','wrap','shawl'],                                                     'scarf wrap shawl'),
  ('Socks',      'fashion', array['sock','socks','hosiery','crew sock'],                                                 'socks hosiery'),
  ('Fragrance',  'beauty',  array['fragrance','perfume','cologne','scent','eau de parfum','eau de toilette'],            'fragrance perfume cologne scent'),
  ('Skincare',   'beauty',  array['skincare','moisturizer','serum','cleanser','toner','sunscreen'],                      'skincare face moisturizer serum'),
  ('Haircare',   'beauty',  array['haircare','shampoo','conditioner','hair cream','hair clay','pomade','dry shampoo','dandruff shampoo'], 'hair shampoo conditioner styling cream'),
  ('Makeup',     'beauty',  array['makeup','lipstick','mascara','foundation','blush','eyeshadow','lip gloss','lipgloss'], 'makeup cosmetics lipstick'),
  ('Decor',      'home',    array['decor','candle','candles','diffuser','reed diffuser','vase','houseplant','plant'],    'candle decor home plant'),
  ('Lighting',   'home',    array['lighting','lamp','floor lamp','table lamp','sconce','pendant'],                       'lighting lamp light'),
  ('Furniture',  'home',    array['furniture','chair','sofa','table','desk','bed','shelf'],                              'furniture chair sofa table'),
  ('Glassware',  'other',   array['glass','glasses','glassware','tumbler','wine glass','cup','mug'],                     'glassware glass cup mug tumbler'),
  ('Jewelry',    'other',   array['jewelry','jewellery','necklace','earring','earrings','bracelet','ring','rings'],      'jewelry necklace earring ring'),
  ('Book',       'other',   array['book','books','novel','reading','hardcover','paperback'],                             'book reading'),
  ('Coffee',     'other',   array['coffee','coffee beans','espresso','brew','grinder'],                                  'coffee beans brew'),
  ('Phone',      'other',   array['phone','phone case','iphone case','android case','case'],                             'phone case accessory'),
  ('Toy',        'other',   array['toy','toys','game','plush'],                                                          'toy game'),
  ('Yoga',       'other',   array['yoga','yoga mat','mat','meditation'],                                                 'yoga mat meditation')
on conflict (type) do update set
  synonyms = excluded.synonyms,
  keywords = excluded.keywords,
  category = excluded.category;
