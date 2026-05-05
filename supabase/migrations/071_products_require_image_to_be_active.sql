-- Enforce the "products must have an image to be active" rule.
--
-- A product with no image_url and no entries in images[] can't be
-- usefully rendered in the consumer feed or passed to the ad generator
-- (fal.ai image-to-video rejects `image_url=null`). Until now ~53% of
-- active products were in that state, so ad generation had a silent
-- failure mode.
--
-- 1) Deactivate every product that is currently is_active=true but has
--    no image at all.
-- 2) Install a BEFORE INSERT/UPDATE trigger that silently clears
--    is_active when the row has no image — so scrapers, admin edits, or
--    imports can never resurrect the bad state.

UPDATE public.products
   SET is_active = false
 WHERE is_active = true
   AND image_url IS NULL
   AND (images IS NULL OR jsonb_array_length(images) = 0);

CREATE OR REPLACE FUNCTION public.products_enforce_image_for_active()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_active IS TRUE
     AND NEW.image_url IS NULL
     AND (NEW.images IS NULL OR jsonb_array_length(NEW.images) = 0) THEN
    NEW.is_active := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_enforce_image_for_active ON public.products;
CREATE TRIGGER trg_products_enforce_image_for_active
  BEFORE INSERT OR UPDATE OF is_active, image_url, images
  ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.products_enforce_image_for_active();
