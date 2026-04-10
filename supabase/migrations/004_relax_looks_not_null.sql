-- 004: Relax NOT NULL constraints for user-created looks
-- 
-- User-created looks (via edge function) don't have video_path or creator_handle
-- at creation time. These are legacy fields from the seed data.
-- New looks use look_videos / look_photos tables for media and user_id for ownership.

-- Allow video_path to be null (user-created looks use look_videos table instead)
ALTER TABLE looks ALTER COLUMN video_path DROP NOT NULL;

-- Allow creator_handle to be null (user-created looks use user_id instead)
ALTER TABLE looks ALTER COLUMN creator_handle DROP DEFAULT;
ALTER TABLE looks DROP CONSTRAINT IF EXISTS looks_creator_handle_fkey;
ALTER TABLE looks ALTER COLUMN creator_handle DROP NOT NULL;

-- Re-add the foreign key but allow nulls
ALTER TABLE looks ADD CONSTRAINT looks_creator_handle_fkey
  FOREIGN KEY (creator_handle) REFERENCES creators(handle) ON DELETE SET NULL;
