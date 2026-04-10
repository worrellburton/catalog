-- ============================================
-- Create storage bucket for look media
-- ============================================

-- Create bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'look-media',
  'look-media',
  true,
  104857600, -- 100MB
  ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/quicktime',
    'video/webm'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for uploaded media
-- Allow authenticated users to upload to their own user folder
CREATE POLICY "Users can upload media to their own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'look-media' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow users to read all public media
CREATE POLICY "Anyone can view public media"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'look-media');

-- Allow users to update/delete media in their own folders
CREATE POLICY "Users can update their own media"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'look-media' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete their own media"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'look-media' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);
