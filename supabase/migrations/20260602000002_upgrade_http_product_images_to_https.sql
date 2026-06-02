-- Anthropic's vision API (pick-primary-image, polish, etc.) only accepts
-- https:// image URLs. Scraped rows from some brand CDNs (e.g. kith.com)
-- landed with an http:// scheme on one or more images, which 400'd the
-- Claude call and surfaced as "pick primary failed". Upgrade every http://
-- product image to https:// — these CDNs all serve the identical asset over
-- TLS, so it's a safe scheme bump. Case-insensitive to catch HTTP:// too.

update public.products
set image_url = 'https://' || substring(image_url from 8)
where image_url ilike 'http://%';

update public.products
set primary_image_url = 'https://' || substring(primary_image_url from 8)
where primary_image_url ilike 'http://%';

update public.products
set images = (
  select jsonb_agg(
    case when img ilike 'http://%' then 'https://' || substring(img from 8) else img end
    order by ord
  )
  from jsonb_array_elements_text(images) with ordinality as e(img, ord)
)
where exists (
  select 1 from jsonb_array_elements_text(images) img where img ilike 'http://%'
);
