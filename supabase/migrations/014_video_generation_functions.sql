-- 014: Helper functions for video generation pipeline

-- Increment ai_model looks_count (called by agent after creating a look)
CREATE OR REPLACE FUNCTION increment_ai_model_looks(model_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE ai_models
  SET looks_count = looks_count + 1
  WHERE id = model_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Find products with scrape_status=done but no generated_videos rows
CREATE OR REPLACE FUNCTION products_without_videos()
RETURNS TABLE(id uuid, name text, brand text, images jsonb) AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.name, p.brand, p.images
  FROM products p
  WHERE p.scrape_status = 'done'
    AND p.images IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM generated_videos gv
      WHERE gv.product_id = p.id
    )
  LIMIT 10;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
