-- Migration 092: Add size_fit and materials_care columns to products
--
-- These fields are extracted by the product scraper agent from "Size & Fit"
-- and "Materials & Care" accordion sections on product pages. They are also
-- included in the embedding document so products become searchable by fabric
-- content, fit description, and care instructions.

alter table public.products
  add column if not exists size_fit text,
  add column if not exists materials_care text;

comment on column public.products.size_fit is
  'Size and fit details scraped from the product page (e.g. "Slim fit. Fits true to size. Model is 6''2" wearing size medium.")';

comment on column public.products.materials_care is
  'Materials and care instructions scraped from the product page (e.g. "75% wool, 25% lyocell. Dry clean only.")';
