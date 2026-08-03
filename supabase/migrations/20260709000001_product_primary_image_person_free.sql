-- Whether the chosen primary image is a person-free packshot (safe to send to
-- the try-on video model, which blocks non-consented human likenesses).
-- true = person-free packshot, false = on-model, null = unknown/unverified.
-- verify-product-image sets this; generate-look sends a product's image only
-- when true, else describes the product in text so the render never blocks.
alter table products add column if not exists primary_image_person_free boolean;

comment on column products.primary_image_person_free is
  'true=primary is a person-free packshot (safe for generative video refs), false=on-model, null=unknown. Set by verify-product-image.';
