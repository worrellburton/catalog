-- 018: Extend product_ads with generation-time options
-- - with_audio: toggle whether the generated video should include audio
-- - reference_image_urls: admin-uploaded images that supplement the product
--   photos when generating the ad (Veo/Seedance reference_images input)

ALTER TABLE product_ads
  ADD COLUMN IF NOT EXISTS with_audio boolean DEFAULT true;

ALTER TABLE product_ads
  ADD COLUMN IF NOT EXISTS reference_image_urls text[] DEFAULT '{}'::text[];
