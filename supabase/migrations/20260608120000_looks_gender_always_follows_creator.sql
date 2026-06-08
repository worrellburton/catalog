-- Creator gender is authoritative for their looks.
-- Fixes: a look could be tagged against the creator's gender (e.g. a female
-- creator's look tagged 'men' from a product/manual tag) and never get
-- corrected — the old sync only fired on a profile-gender UPDATE and the
-- insert-default only filled unset/'unisex'. Now the look gender is forced
-- from the creator on insert/update, a profile-gender change re-tags all the
-- creator's looks (by user_id OR creator_handle), and existing looks are
-- backfilled.

-- 1) Force a look's gender from its creator on insert + any gender/owner change.
CREATE OR REPLACE FUNCTION public.force_look_gender_from_creator()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_g text;
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  SELECT gender INTO v_g FROM public.profiles WHERE id = NEW.user_id;
  IF v_g = 'male' THEN NEW.gender := 'men';
  ELSIF v_g = 'female' THEN NEW.gender := 'women';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_default_look_gender_from_creator ON public.looks;
DROP TRIGGER IF EXISTS trg_force_look_gender_from_creator ON public.looks;
CREATE TRIGGER trg_force_look_gender_from_creator
  BEFORE INSERT OR UPDATE OF gender, user_id ON public.looks
  FOR EACH ROW EXECUTE FUNCTION public.force_look_gender_from_creator();

-- 2) Profile gender change → re-tag every look the creator owns (user_id OR handle).
CREATE OR REPLACE FUNCTION public.sync_looks_gender_from_profile()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_handle text; v_look_g text;
BEGIN
  IF NEW.gender IS NOT DISTINCT FROM OLD.gender THEN RETURN NEW; END IF;
  IF NEW.gender = 'male' THEN v_look_g := 'men';
  ELSIF NEW.gender = 'female' THEN v_look_g := 'women';
  ELSE RETURN NEW; END IF;
  SELECT handle INTO v_handle FROM public.creators WHERE id = NEW.id;
  UPDATE public.looks SET gender = v_look_g
   WHERE (user_id = NEW.id OR (v_handle IS NOT NULL AND creator_handle = v_handle))
     AND gender IS DISTINCT FROM v_look_g;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_looks_gender_from_profile ON public.profiles;
CREATE TRIGGER trg_sync_looks_gender_from_profile
  AFTER UPDATE OF gender ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_looks_gender_from_profile();

-- 3) Backfill every existing look to its creator's gender (by user_id, then handle).
UPDATE public.looks l
   SET gender = CASE p.gender WHEN 'male' THEN 'men' WHEN 'female' THEN 'women' END
  FROM public.profiles p
 WHERE l.user_id = p.id
   AND p.gender IN ('male','female')
   AND l.gender IS DISTINCT FROM (CASE p.gender WHEN 'male' THEN 'men' WHEN 'female' THEN 'women' END);

UPDATE public.looks l
   SET gender = CASE p.gender WHEN 'male' THEN 'men' WHEN 'female' THEN 'women' END
  FROM public.creators c
  JOIN public.profiles p ON p.id = c.id
 WHERE l.user_id IS NULL
   AND l.creator_handle = c.handle
   AND p.gender IN ('male','female')
   AND l.gender IS DISTINCT FROM (CASE p.gender WHEN 'male' THEN 'men' WHEN 'female' THEN 'women' END);
