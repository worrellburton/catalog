import { supabase } from '~/utils/supabase';

export interface GeneratedVideo {
  id: string;
  product_id: string;
  ai_model_id: string | null;
  style: string;
  model_persona: string | null;
  prompt: string | null;
  veo_model: string | null;
  status: 'pending' | 'generating' | 'uploading' | 'done' | 'failed';
  veo_operation_id: string | null;
  video_url: string | null;
  storage_path: string | null;
  look_id: string | null;
  duration_seconds: number | null;
  aspect_ratio: string | null;
  resolution: string | null;
  cost_usd: number | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  // joined data
  product?: { id: string; name: string | null; brand: string | null; image_url: string | null };
  ai_model?: { id: string; name: string; slug: string; primary_image: string | null } | null;
}

export async function getGeneratedVideos(): Promise<GeneratedVideo[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('generated_videos')
    .select(`
      *,
      product:products(id, name, brand, image_url),
      ai_model:ai_models(id, name, slug, primary_image)
    `)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to load generated videos:', error.message);
    return [];
  }
  return (data || []) as GeneratedVideo[];
}

export async function getGeneratedVideosByStatus(status: string): Promise<GeneratedVideo[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('generated_videos')
    .select(`
      *,
      product:products(id, name, brand, image_url),
      ai_model:ai_models(id, name, slug, primary_image)
    `)
    .eq('status', status)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to load generated videos:', error.message);
    return [];
  }
  return (data || []) as GeneratedVideo[];
}

export async function retryGeneratedVideo(id: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase
    .from('generated_videos')
    .update({ status: 'pending', error: null, completed_at: null })
    .eq('id', id);
  if (error) return { error: error.message };
  return { error: null };
}

export async function deleteGeneratedVideo(id: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase
    .from('generated_videos')
    .delete()
    .eq('id', id);
  if (error) return { error: error.message };
  return { error: null };
}

export async function approveLook(lookId: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase
    .from('looks')
    .update({ status: 'live', enabled: true })
    .eq('id', lookId);
  if (error) return { error: error.message };
  return { error: null };
}

export async function denyLook(lookId: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase
    .from('looks')
    .update({ status: 'denied', enabled: false })
    .eq('id', lookId);
  if (error) return { error: error.message };
  return { error: null };
}
