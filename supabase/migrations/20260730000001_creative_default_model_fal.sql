-- Route product creatives through fal instead of Google.
--
-- The old default 'veo-3.1-fast-generate-preview' is the DIRECT Google slug, so
-- every automated creative depended on GOOGLE_API_KEY. When that key expired on
-- 2026-07-30 the entire creative stage stopped. fal is already wired for this -
-- ad_generator._generate_with_retry routes bytedance/* and fal-ai/* through
-- seedance_client / generate_from_fal_model, authed by FAL_KEY - so this is a
-- slug change, not new capability. The code comment even lists "Veo via fal".
--
-- Chosen: seedance-2.0/fast/reference-to-video (founder's call; proven on this
-- catalog, silent output). NOTE the 'reference' in the slug is misleading here:
-- the Seedance branch in ad_generator sends usable[0] - ONE image - and its own
-- comment reads "no reference-images concept". Only a reference slug on the
-- GENERIC fal path (fal-ai/vidu/reference-to-video) actually sends 3. Do not
-- assume multi-reference behaviour from the slug name.
--
-- ~$0.15 / 5s = $0.030/s, which pricing.py already prices correctly (verified).
alter table public.product_creative
  alter column model set default 'bytedance/seedance-2.0/fast/reference-to-video';
