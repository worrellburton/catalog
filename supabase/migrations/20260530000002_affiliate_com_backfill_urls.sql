-- Backfill products.url + ancillary fields from raw_data for rows that
-- came in via the affiliate.com import before the productLink() service
-- accessor knew to look inside `raw_data.urls.affiliate` / .direct.
-- Without this, those rows render with "No URL recorded" and the admin
-- Affiliate Providers panel had nothing to link to.
--
-- Safe to re-run: only updates columns that are NULL.

update public.products
set
  url = coalesce(
    url,
    nullif(raw_data->'urls'->>'affiliate', ''),
    nullif(raw_data->'urls'->>'outclick',  ''),
    nullif(raw_data->'urls'->>'direct',    ''),
    nullif(raw_data->>'commission_url',    ''),
    nullif(raw_data->>'direct_url',        '')
  ),
  currency = coalesce(currency, nullif(raw_data->>'currency', '')),
  price = coalesce(
    price,
    case when (raw_data->>'regular_price') ~ '^[0-9]+(\.[0-9]+)?$'
         then (raw_data->>'regular_price') end
  ),
  discounted_price = coalesce(
    discounted_price,
    case when (raw_data->>'final_price') ~ '^[0-9]+(\.[0-9]+)?$'
          and (raw_data->>'final_price') <> coalesce(raw_data->>'regular_price', '')
         then (raw_data->>'final_price') end
  ),
  gender = coalesce(
    gender,
    case when lower(raw_data->>'gender') in ('male','female','unisex')
         then lower(raw_data->>'gender') end
  ),
  description = coalesce(description, nullif(raw_data->>'description', ''))
where source = 'affiliate.com';
