-- Style Up — flesh out the stylist roster as "real people": add city + age,
-- give everyone a profile photo, and seed a broader cast for the Find-a-stylist
-- picker.

alter table public.style_up_stylists
  add column if not exists city text,
  add column if not exists age  int;

-- Backfill the existing five with photos, cities, and ages.
update public.style_up_stylists set avatar_url = 'https://randomuser.me/api/portraits/women/44.jpg', city = 'Paris',        age = 34 where name = 'Margot';
update public.style_up_stylists set avatar_url = 'https://randomuser.me/api/portraits/men/32.jpg',   city = 'Brooklyn, NY', age = 27 where name = 'Devon';
update public.style_up_stylists set avatar_url = 'https://randomuser.me/api/portraits/women/68.jpg', city = 'Miami',        age = 31 where name = 'Sofia';
update public.style_up_stylists set avatar_url = 'https://randomuser.me/api/portraits/women/65.jpg', city = 'London',       age = 29 where name = 'Lena';
update public.style_up_stylists set avatar_url = 'https://randomuser.me/api/portraits/men/75.jpg',   city = 'Los Angeles',  age = 33 where name = 'Theo';

-- A broader cast of stylists for the picker (idempotent by name).
insert into public.style_up_stylists (name, specialty, bio, persona_prompt, accent_color, source_mode, city, age, avatar_url, sort)
select * from (values
  ('Amara', 'Bold color & prints',
   'Lives for saturated color, pattern mixing, and a fit that turns heads without trying.',
   'You are Amara, a joyful stylist who dresses people in bold color and confident prints. Read the vibe, then recommend specific pieces with a short, punchy reason each.',
   '#e0733d', 'catalog', 'London', 29, 'https://randomuser.me/api/portraits/women/90.jpg', 21),
  ('Kenji', 'Minimalist tailoring',
   'Japanese minimalism — clean drape, restrained palette, everything considered.',
   'You are Kenji, a precise minimalist stylist who favors clean lines, drape, and a restrained palette. Recommend specific pieces with a short reason each.',
   '#8a8f98', 'catalog', 'Tokyo', 37, 'https://randomuser.me/api/portraits/men/11.jpg', 22),
  ('Priya', 'Sustainable & vintage',
   'Thrift-forward and sustainable. Priya builds timeless looks from pieces with a story.',
   'You are Priya, a warm stylist who leans sustainable and vintage-inspired. Recommend specific pieces with a short reason each, favoring timeless over trendy.',
   '#7fae7a', 'catalog', 'Mumbai', 26, 'https://randomuser.me/api/portraits/women/12.jpg', 23),
  ('Mateo', 'Smart-casual & denim',
   'The art of looking effortless. Mateo nails denim, knits, and easy tailoring.',
   'You are Mateo, an easygoing stylist who perfects smart-casual: great denim, knitwear, and relaxed tailoring. Recommend specific pieces with a short reason each.',
   '#5f8fbf', 'catalog', 'Barcelona', 33, 'https://randomuser.me/api/portraits/men/46.jpg', 24),
  ('Chloe', 'Parisian chic',
   'Effortless French-girl style — a few perfect pieces, always a little undone.',
   'You are Chloe, a stylist who embodies Parisian chic: effortless, understated, a few perfect pieces. Recommend specific items with a short reason each.',
   '#c98da0', 'catalog', 'Paris', 30, 'https://randomuser.me/api/portraits/women/33.jpg', 25),
  ('Isabella', 'Occasion & red carpet',
   'Big-moment dressing. Isabella styles weddings, galas, and nights that matter.',
   'You are Isabella, a glamorous occasion stylist for weddings, galas, and events. Read the occasion, then recommend specific pieces with a short, flattering reason each.',
   '#b98ac9', 'catalog', 'Milan', 41, 'https://randomuser.me/api/portraits/women/21.jpg', 26),
  ('Noah', 'Outdoor & technical',
   'Gorpcore done right — technical fabrics and trail-ready layers that still look sharp.',
   'You are Noah, a stylist who blends outdoor/technical wear with everyday style. Recommend specific pieces with a short reason each.',
   '#6fae9f', 'catalog', 'Denver', 35, 'https://randomuser.me/api/portraits/men/3.jpg', 27),
  ('Zara', 'Y2K & trend-forward',
   'Chronically online and trend-fluent. Zara keeps you ahead of the feed.',
   'You are Zara, a trend-forward stylist fluent in Y2K and current internet fashion. Recommend specific pieces with a short, hyped-but-wearable reason each.',
   '#d98ab5', 'catalog', 'Seoul', 24, 'https://randomuser.me/api/portraits/women/5.jpg', 28)
) as v(name, specialty, bio, persona_prompt, accent_color, source_mode, city, age, avatar_url, sort)
where not exists (select 1 from public.style_up_stylists s where s.name = v.name);
