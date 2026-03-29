-- Seed Data — Run after 001_initial_schema.sql

-- ============================================
-- CREATORS
-- ============================================
insert into creators (handle, display_name, avatar_url) values
  ('@lilywittman', 'Lily Wittman', 'https://i.pravatar.cc/100?img=47'),
  ('@garrett', 'Garrett', 'https://i.pravatar.cc/100?img=12')
on conflict (handle) do nothing;

-- ============================================
-- PRODUCTS
-- ============================================
insert into products (id, name, brand, price, url, image_url) values
  ('a0000000-0000-0000-0000-000000000001', 'Patchwork Pointelle Short-Sleeve Shirt', 'Vince', '$568', 'https://www.vince.com/product/patchwork-pointelle-short-sleeve-shirt-M03516417A.html', 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=200&h=200&fit=crop'),
  ('a0000000-0000-0000-0000-000000000002', 'Light Blue Straight Leg Jeans', 'Suitsupply', '$199', 'https://suitsupply.com', 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=200&h=200&fit=crop'),
  ('a0000000-0000-0000-0000-000000000003', 'B27 Uptown Low-Top Sneaker Gray and White', 'Dior', '$1,200', 'https://www.dior.com', 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=200&h=200&fit=crop'),
  ('a0000000-0000-0000-0000-000000000004', 'Digital Camera', 'Fujifilm', '$1,725', 'https://www.fujifilm.com', 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=200&h=200&fit=crop'),
  ('a0000000-0000-0000-0000-000000000005', 'Rock Style Flap Shoulder Bag', 'Zara', '$49', 'https://www.zara.com', 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=200&h=200&fit=crop'),
  ('a0000000-0000-0000-0000-000000000006', 'Major Shade Cat Eye Sunglasses', 'Windsor', '$10', 'https://www.windsorstore.com', 'https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=200&h=200&fit=crop'),
  ('a0000000-0000-0000-0000-000000000007', 'Oval D Glitter Case for iPhone 16 Pro', 'Diesel', '$39', 'https://www.diesel.com', 'https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=200&h=200&fit=crop'),
  ('a0000000-0000-0000-0000-000000000008', 'Cross Pendant Necklace', 'Pavoi', '$13', 'https://www.pavoi.com', 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=200&h=200&fit=crop')
on conflict (id) do nothing;

-- ============================================
-- LOOKS
-- ============================================
insert into looks (legacy_id, title, video_path, gender, creator_handle, description, color) values
  (1,  'Look 01', 'girl2.mp4', 'women', '@lilywittman', 'A curated selection of essential pieces for the modern wardrobe.', '#c4a882'),
  (2,  'Look 02', 'guy.mp4',   'men',   '@garrett',     'Effortless layering with neutral tones and soft textures.', '#8b9e8b'),
  (3,  'Look 03', 'girl2.mp4', 'women', '@lilywittman', 'Sharp tailoring meets relaxed silhouettes.', '#a89090'),
  (4,  'Look 04', 'guy.mp4',   'men',   '@garrett',     'Minimalist elegance with bold accessories.', '#8899aa'),
  (5,  'Look 05', 'girl2.mp4', 'women', '@lilywittman', 'Weekend ready with refined casual pieces.', '#b8a898'),
  (6,  'Look 06', 'guy.mp4',   'men',   '@garrett',     'Evening allure with timeless sophistication.', '#787878'),
  (7,  'Look 07', 'girl2.mp4', 'women', '@lilywittman', 'Transitional dressing for in-between seasons.', '#9ca88c'),
  (8,  'Look 08', 'guy.mp4',   'men',   '@garrett',     'Monochrome mastery with textural contrast.', '#a09088'),
  (9,  'Look 09', 'girl2.mp4', 'women', '@lilywittman', 'Artful draping and fluid movement.', '#8a8a9e'),
  (10, 'Look 10', 'guy.mp4',   'men',   '@garrett',     'Power dressing reimagined for today.', '#aa9e88'),
  (11, 'Look 11', 'girl2.mp4', 'women', '@lilywittman', 'Soft palette with unexpected proportions.', '#9e8a7e'),
  (12, 'Look 12', 'guy.mp4',   'men',   '@garrett',     'Polished ease for every occasion.', '#7e8e8e')
on conflict (legacy_id) do nothing;

-- ============================================
-- LOOK_PRODUCTS (junction)
-- Guy looks (2,4,6,8,10,12) get guy products
-- Girl looks (1,3,5,7,9,11) get girl products
-- ============================================
insert into look_products (look_id, product_id, sort_order)
select l.id, p.id, row_number() over (partition by l.id order by p.id) - 1
from looks l
cross join products p
where l.gender = 'men'
  and p.id in (
    'a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000004'
  )
on conflict (look_id, product_id) do nothing;

insert into look_products (look_id, product_id, sort_order)
select l.id, p.id, row_number() over (partition by l.id order by p.id) - 1
from looks l
cross join products p
where l.gender = 'women'
  and p.id in (
    'a0000000-0000-0000-0000-000000000005',
    'a0000000-0000-0000-0000-000000000006',
    'a0000000-0000-0000-0000-000000000007',
    'a0000000-0000-0000-0000-000000000008'
  )
on conflict (look_id, product_id) do nothing;

-- ============================================
-- SEARCH SUGGESTIONS
-- ============================================
insert into search_suggestions (text, sort_order) values
  ('beach day', 1), ('mens shorts', 2), ('omg shoes', 3), ('make me hot', 4),
  ('date night outfit', 5), ('gym fits', 6), ('summer dresses', 7), ('streetwear', 8),
  ('brunch outfit', 9), ('skincare routine', 10), ('festival looks', 11), ('quiet luxury', 12),
  ('clean girl aesthetic', 13), ('wedding guest dress', 14), ('vintage finds', 15),
  ('sneaker rotation', 16), ('concert outfit', 17), ('airport outfit', 18),
  ('first date fit', 19), ('matcha everything', 20), ('pilates princess', 21),
  ('cozy fall vibes', 22), ('coffee shops LA', 23), ('travel essentials', 24),
  ('old money style', 25), ('dopamine dressing', 26), ('it girl energy', 27),
  ('minimalist wardrobe', 28), ('hot girl walk essentials', 29), ('lazy sunday', 30)
on conflict (text) do nothing;
