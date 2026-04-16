-- 013: Generated videos table for AI video generation pipeline

CREATE TABLE IF NOT EXISTS generated_videos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ai_model_id      uuid REFERENCES ai_models(id) ON DELETE SET NULL,  -- which AI model was used
  style            text NOT NULL,                          -- editorial_runway | street_style | studio_clean | lifestyle_context
  model_persona    text,                                   -- persona description used for generation
  prompt           text,                                   -- full Veo prompt used
  veo_model        text DEFAULT 'veo-3.1-fast-generate-preview',
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','generating','uploading','done','failed')),
  veo_operation_id text,                                   -- async operation ID for polling
  video_url        text,                                   -- final Supabase public URL
  storage_path     text,                                   -- Supabase storage path
  look_id          uuid REFERENCES looks(id),              -- set after look creation
  duration_seconds numeric DEFAULT 4,
  aspect_ratio     text DEFAULT '9:16',
  resolution       text DEFAULT '720p',
  cost_usd         numeric,                                -- $0.05–$0.10 per video (fast tier)
  error            text,
  created_at       timestamptz DEFAULT now(),
  completed_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_generated_videos_status ON generated_videos(status);
CREATE INDEX IF NOT EXISTS idx_generated_videos_product_style ON generated_videos(product_id, style);
CREATE INDEX IF NOT EXISTS idx_generated_videos_ai_model ON generated_videos(ai_model_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE generated_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read generated_videos" ON generated_videos FOR SELECT USING (true);
