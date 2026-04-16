-- Fix security advisor warnings:
-- 1. Set fixed search_path on update_updated_at function (prevents search_path injection)
-- 2. Remove broad SELECT policies on public buckets (public URL access works without them)

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "Anyone can read avatars" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can read logos" ON storage.objects;
DROP POLICY IF EXISTS "Public read look media" ON storage.objects;
