-- 003: Add missing columns, tables, and policies for looks management
-- Fixes: "column user_id does not exist" and related schema gaps

-- ============================================
-- 1. ADD MISSING COLUMNS TO LOOKS
-- ============================================

-- user_id: links look to the Supabase Auth user who created it
-- nullable for legacy/seed looks that only have creator_handle
ALTER TABLE looks ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- status: workflow state for look moderation
ALTER TABLE looks ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'live'
  CHECK (status IN ('draft', 'submitted', 'in_review', 'live', 'denied', 'archived'));

-- enabled: quick toggle to show/hide a look
ALTER TABLE looks ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;

-- thumbnail_url: cover/poster image URL
ALTER TABLE looks ADD COLUMN IF NOT EXISTS thumbnail_url text;

-- archived_at: timestamp when the look was archived
ALTER TABLE looks ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- ============================================
-- 2. FIX GENDER CHECK CONSTRAINT
--    Old: ('men', 'women')  →  New: ('men', 'women', 'unisex')
-- ============================================

ALTER TABLE looks DROP CONSTRAINT IF EXISTS looks_gender_check;
ALTER TABLE looks ADD CONSTRAINT looks_gender_check
  CHECK (gender IN ('men', 'women', 'unisex'));

-- ============================================
-- 3. CREATE LOOK_PHOTOS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS look_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  look_id uuid NOT NULL REFERENCES looks(id) ON DELETE CASCADE,
  order_index integer NOT NULL DEFAULT 0,
  storage_path text,
  url text,
  thumbnail_url text,
  transform jsonb,
  deleted_at timestamptz,              -- soft delete
  created_at timestamptz DEFAULT now()
);

-- ============================================
-- 4. CREATE LOOK_VIDEOS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS look_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  look_id uuid NOT NULL REFERENCES looks(id) ON DELETE CASCADE,
  order_index integer NOT NULL DEFAULT 0,
  storage_path text,
  url text,
  poster_url text,
  duration_seconds numeric,
  deleted_at timestamptz,              -- soft delete
  created_at timestamptz DEFAULT now()
);

-- ============================================
-- 5. INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_looks_user_id ON looks(user_id);
CREATE INDEX IF NOT EXISTS idx_looks_status ON looks(status);
CREATE INDEX IF NOT EXISTS idx_look_photos_look_id ON look_photos(look_id);
CREATE INDEX IF NOT EXISTS idx_look_videos_look_id ON look_videos(look_id);

-- ============================================
-- 6. ROW LEVEL SECURITY
-- ============================================

ALTER TABLE look_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE look_videos ENABLE ROW LEVEL SECURITY;

-- Public read access for new tables
CREATE POLICY "Public read look_photos" ON look_photos FOR SELECT USING (true);
CREATE POLICY "Public read look_videos" ON look_videos FOR SELECT USING (true);

-- Authenticated users can manage their own looks
CREATE POLICY "Users can insert own looks" ON looks
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own looks" ON looks
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own looks" ON looks
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Authenticated users can manage photos/videos for their own looks
CREATE POLICY "Users can insert own look_photos" ON look_photos
  FOR INSERT TO authenticated
  WITH CHECK (look_id IN (SELECT id FROM looks WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own look_photos" ON look_photos
  FOR UPDATE TO authenticated
  USING (look_id IN (SELECT id FROM looks WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own look_photos" ON look_photos
  FOR DELETE TO authenticated
  USING (look_id IN (SELECT id FROM looks WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own look_videos" ON look_videos
  FOR INSERT TO authenticated
  WITH CHECK (look_id IN (SELECT id FROM looks WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own look_videos" ON look_videos
  FOR UPDATE TO authenticated
  USING (look_id IN (SELECT id FROM looks WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own look_videos" ON look_videos
  FOR DELETE TO authenticated
  USING (look_id IN (SELECT id FROM looks WHERE user_id = auth.uid()));

-- Authenticated users can manage look_products for their own looks
CREATE POLICY "Users can insert own look_products" ON look_products
  FOR INSERT TO authenticated
  WITH CHECK (look_id IN (SELECT id FROM looks WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own look_products" ON look_products
  FOR DELETE TO authenticated
  USING (look_id IN (SELECT id FROM looks WHERE user_id = auth.uid()));

-- Authenticated users can insert products (when adding new products to looks)
CREATE POLICY "Authenticated users can insert products" ON products
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- ============================================
-- 7. UPDATED_AT TRIGGERS FOR NEW TABLES
-- ============================================
-- (look_photos and look_videos don't have updated_at, so no trigger needed)
