-- Migration 085: Add product quality scoring for scraped products
--
-- Adds quality_score column and automatic quality assessment for scraped
-- products. Used to filter high-quality products for activation.
--
-- Quality criteria:
--   • Has complete data (name, brand, type, price, image, url, description)
--   • Valid price format (not "N/A", not placeholder)
--   • Valid image URL (https://, not placeholder)
--   • Meaningful name (not "Product", not generic)
--   • Description length > 50 chars
--
-- Score ranges:
--   100: Perfect (all fields complete and valid)
--   75-99: Good (minor issues, safe to activate)
--   50-74: Fair (usable but needs review)
--   0-49: Poor (missing critical data, don't activate)

-- Add quality_score column
alter table public.products
  add column if not exists quality_score int default null;

comment on column public.products.quality_score is
  'Automatic quality assessment (0-100): 75+ = safe to activate, 50-74 = review needed, <50 = poor quality';

-- Quality scoring function
create or replace function public.products_compute_quality_score()
returns trigger
language plpgsql
as $$
declare
  v_score int := 0;
begin
  -- Base score starts at 100, deduct for missing/invalid fields
  v_score := 100;

  -- Critical fields (20 points each)
  if NEW.name is null or NEW.name = '' then
    v_score := v_score - 20;
  elsif NEW.name ~* '^(product|item|untitled)' then
    v_score := v_score - 10;  -- Generic name
  end if;

  if NEW.url is null or NEW.url = '' then
    v_score := v_score - 20;
  elsif not (NEW.url ~* '^https?://') then
    v_score := v_score - 10;  -- Invalid URL format
  end if;

  if NEW.image_url is null or NEW.image_url = '' then
    v_score := v_score - 20;
  elsif not (NEW.image_url ~* '^https?://') then
    v_score := v_score - 10;  -- Invalid image URL
  elsif NEW.image_url ~* '(placeholder|default|no-image)' then
    v_score := v_score - 10;  -- Placeholder image
  end if;

  -- Important fields (10 points each)
  if NEW.brand is null or NEW.brand = '' then
    v_score := v_score - 10;
  end if;

  if NEW.type is null or NEW.type = '' then
    v_score := v_score - 10;
  end if;

  if NEW.price is null or NEW.price = '' then
    v_score := v_score - 10;
  elsif NEW.price ~* '(n/a|tbd|call|contact)' then
    v_score := v_score - 5;  -- Invalid price format
  end if;

  -- Nice-to-have fields (5 points each)
  if NEW.description is null or length(NEW.description) < 50 then
    v_score := v_score - 5;
  end if;

  if NEW.gender is null then
    v_score := v_score - 5;
  end if;

  -- Ensure score is in valid range
  if v_score < 0 then
    v_score := 0;
  elsif v_score > 100 then
    v_score := 100;
  end if;

  NEW.quality_score := v_score;
  return NEW;
end;
$$;

comment on function public.products_compute_quality_score() is
  'Auto-compute quality score (0-100) based on data completeness and validity. Triggers on insert/update.';

-- Trigger to auto-compute quality score
drop trigger if exists trg_products_quality_score on public.products;

create trigger trg_products_quality_score
  before insert or update on public.products
  for each row
  execute function public.products_compute_quality_score();

comment on trigger trg_products_quality_score on public.products is
  'Auto-compute quality_score on insert/update. Used to filter high-quality scraped products for activation.';

-- Backfill quality scores for existing products
update public.products
set quality_score = quality_score  -- trigger will recompute
where quality_score is null;
