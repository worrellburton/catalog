-- 012: AI Models / Personas for video generation
-- These are virtual models with preset faces/styles used to generate fashion looks.
-- Each ai_model is linked to a creator record so they appear in the app like real creators.

-- ============================================
-- AI MODELS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS ai_models (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id      uuid UNIQUE REFERENCES creators(id) ON DELETE SET NULL,  -- linked creator profile
  name            text NOT NULL,                          -- display name, e.g. "Aria Rose"
  slug            text UNIQUE NOT NULL,                   -- url-friendly handle, e.g. "aria-rose"
  gender          text NOT NULL CHECK (gender IN ('female', 'male', 'non_binary')),
  ethnicity       text,                                   -- optional: for diversity tracking
  age_range       text CHECK (age_range IN ('18-25', '26-35', '36-45', '46+')),
  bio             text,                                   -- short bio shown on creator page

  -- Face reference images (stored in Supabase Storage)
  face_images     jsonb NOT NULL DEFAULT '[]'::jsonb,     -- array of URLs: front, 3/4 angle, profile
  primary_image   text,                                   -- main headshot URL

  -- Style presets
  default_style   text NOT NULL DEFAULT 'editorial_runway'
                    CHECK (default_style IN ('editorial_runway', 'street_style', 'studio_clean', 'lifestyle_context')),
  style_presets   jsonb NOT NULL DEFAULT '["editorial_runway"]'::jsonb,  -- array of enabled styles
  persona_prompt  text,                                   -- custom Veo persona description override

  -- Stats (denormalized for admin display)
  looks_count     integer NOT NULL DEFAULT 0,
  followers_count integer NOT NULL DEFAULT 0,

  -- Status
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive', 'archived')),
  enabled         boolean NOT NULL DEFAULT true,

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_ai_models_status ON ai_models(status);
CREATE INDEX IF NOT EXISTS idx_ai_models_slug ON ai_models(slug);
CREATE INDEX IF NOT EXISTS idx_ai_models_creator ON ai_models(creator_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE ai_models ENABLE ROW LEVEL SECURITY;

-- Public read access (app users see these as normal creators)
CREATE POLICY "Public read ai_models" ON ai_models FOR SELECT USING (true);

-- Service role can manage (admin panel uses service key via Edge Functions)
-- No direct write policies for anon/authenticated — managed via admin API

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================

CREATE TRIGGER set_ai_models_updated_at
  BEFORE UPDATE ON ai_models
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- ADD is_ai FLAG TO CREATORS
-- ============================================

ALTER TABLE creators ADD COLUMN IF NOT EXISTS is_ai boolean NOT NULL DEFAULT false;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS ai_model_id uuid REFERENCES ai_models(id) ON DELETE SET NULL;
