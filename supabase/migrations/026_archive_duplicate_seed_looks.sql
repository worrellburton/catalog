-- Seed data inserted 12 look rows that collectively reference only two
-- unique video files (girl2.mp4 and guy.mp4), so the admin "all" catalog
-- rendered the same video 6 times each. Archive the duplicates so the
-- DB reflects reality: one active look per unique video.
--
-- Scoped to legacy_id <= 12 so this only touches seed rows; real user
-- uploads that happen to share a video path are left alone.

UPDATE public.looks
SET archived_at = now()
WHERE archived_at IS NULL
  AND legacy_id IS NOT NULL
  AND legacy_id <= 12
  AND video_path IS NOT NULL
  AND id IN (
    SELECT id FROM (
      SELECT id,
        ROW_NUMBER() OVER (PARTITION BY video_path ORDER BY legacy_id) AS rn
      FROM public.looks
      WHERE archived_at IS NULL
        AND legacy_id IS NOT NULL
        AND legacy_id <= 12
        AND video_path IS NOT NULL
    ) t
    WHERE t.rn > 1
  );
