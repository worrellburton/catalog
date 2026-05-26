-- Backfill looks.gender from the creator's profile gender. Most live
-- looks today were tagged 'unisex' even though the creator is clearly
-- male or female and the clothes match — because the publish form
-- defaulted to 'unisex'. Result: a male shopper saw women's looks
-- anyway since 'unisex' passes the gender filter for everyone.
--
-- Rule:
--   profiles.gender = 'male'   → looks.gender = 'men'
--   profiles.gender = 'female' → looks.gender = 'women'
--   anything else              → leave as-is (catalog-wide)
--
-- Only touches rows currently tagged 'unisex' — admin-curated 'men'/
-- 'women' tags are preserved.

UPDATE public.looks l
SET gender = 'men'
FROM public.profiles p
WHERE p.id = l.user_id
  AND p.gender = 'male'
  AND l.gender = 'unisex';

UPDATE public.looks l
SET gender = 'women'
FROM public.profiles p
WHERE p.id = l.user_id
  AND p.gender = 'female'
  AND l.gender = 'unisex';
