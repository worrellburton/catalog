-- Keep looks.gender in lockstep with the creator's profile gender.
--
-- Two triggers cover both directions:
--   A) When a creator updates their profile gender, propagate to every
--      look they own (status doesn't matter — draft/live/archived all
--      get re-tagged so a switch from female→male doesn't leave a
--      stale gender lurking on a draft that goes live later).
--   B) On INSERT of a look, if no explicit gender was supplied (or
--      'unisex' was supplied as the publish-form default), inherit
--      from the creator's profile gender. Admin overrides win:
--      explicitly inserting gender='men' on a female creator's look
--      still wins, only the 'unisex' fallback path inherits.

CREATE OR REPLACE FUNCTION public.sync_looks_gender_from_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.gender IS NOT DISTINCT FROM OLD.gender THEN
    RETURN NEW;
  END IF;
  IF NEW.gender = 'male' THEN
    UPDATE public.looks SET gender = 'men'
     WHERE user_id = NEW.id
       AND gender IS DISTINCT FROM 'men';
  ELSIF NEW.gender = 'female' THEN
    UPDATE public.looks SET gender = 'women'
     WHERE user_id = NEW.id
       AND gender IS DISTINCT FROM 'women';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_looks_gender_from_profile ON public.profiles;
CREATE TRIGGER trg_sync_looks_gender_from_profile
  AFTER UPDATE OF gender ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_looks_gender_from_profile();

CREATE OR REPLACE FUNCTION public.default_look_gender_from_creator()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator_gender text;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.gender IS NOT NULL AND NEW.gender NOT IN ('unisex') THEN
    RETURN NEW;
  END IF;
  SELECT gender INTO v_creator_gender
    FROM public.profiles
   WHERE id = NEW.user_id;
  IF v_creator_gender = 'male' THEN
    NEW.gender := 'men';
  ELSIF v_creator_gender = 'female' THEN
    NEW.gender := 'women';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_default_look_gender_from_creator ON public.looks;
CREATE TRIGGER trg_default_look_gender_from_creator
  BEFORE INSERT ON public.looks
  FOR EACH ROW
  EXECUTE FUNCTION public.default_look_gender_from_creator();
