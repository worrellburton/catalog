import { supabase } from '~/utils/supabase';

export interface AiModel {
  id: string;
  creator_id: string | null;
  name: string;
  slug: string;
  gender: 'female' | 'male' | 'non_binary';
  ethnicity: string | null;
  age_range: string | null;
  bio: string | null;
  face_images: string[];
  primary_image: string | null;
  default_style: string;
  style_presets: string[];
  persona_prompt: string | null;
  looks_count: number;
  followers_count: number;
  status: 'active' | 'inactive' | 'archived';
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AiModelFormData {
  name: string;
  slug: string;
  gender: 'female' | 'male' | 'non_binary';
  ethnicity?: string;
  age_range?: string;
  bio?: string;
  face_images?: string[];
  primary_image?: string;
  default_style?: string;
  style_presets?: string[];
  persona_prompt?: string;
  status?: 'active' | 'inactive' | 'archived';
  enabled?: boolean;
}

export async function getAiModels(): Promise<AiModel[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('ai_models')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to load AI models:', error.message);
    return [];
  }
  return data || [];
}

export async function getAiModel(id: string): Promise<AiModel | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('ai_models')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Failed to load AI model:', error.message);
    return null;
  }
  return data;
}

export async function createAiModel(form: AiModelFormData): Promise<{ data: AiModel | null; error: string | null }> {
  if (!supabase) return { data: null, error: 'Supabase not configured' };

  // 1. Create creator record first (so the model appears as a creator in the app)
  const handle = form.slug;
  const { data: creator, error: creatorErr } = await supabase
    .from('creators')
    .insert({
      handle,
      display_name: form.name,
      avatar_url: form.primary_image || null,
      bio: form.bio || null,
      is_ai: true,
    })
    .select('id')
    .single();

  if (creatorErr) {
    console.error('Failed to create creator for AI model:', creatorErr.message);
    return { data: null, error: creatorErr.message };
  }

  // 2. Create ai_model record linked to the creator
  const { data, error } = await supabase
    .from('ai_models')
    .insert({
      creator_id: creator.id,
      name: form.name,
      slug: form.slug,
      gender: form.gender,
      ethnicity: form.ethnicity || null,
      age_range: form.age_range || null,
      bio: form.bio || null,
      face_images: form.face_images || [],
      primary_image: form.primary_image || null,
      default_style: form.default_style || 'editorial_runway',
      style_presets: form.style_presets || ['editorial_runway'],
      persona_prompt: form.persona_prompt || null,
      status: form.status || 'active',
      enabled: form.enabled ?? true,
    })
    .select('*')
    .single();

  if (error) {
    console.error('Failed to create AI model:', error.message);
    return { data: null, error: error.message };
  }

  // 3. Back-link creator to ai_model
  await supabase
    .from('creators')
    .update({ ai_model_id: data.id })
    .eq('id', creator.id);

  return { data, error: null };
}

export async function updateAiModel(id: string, updates: Partial<AiModelFormData>): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };

  const { error } = await supabase
    .from('ai_models')
    .update(updates)
    .eq('id', id);

  if (error) return { error: error.message };

  // Sync creator record if name/image/bio changed
  const model = await getAiModel(id);
  if (model?.creator_id) {
    const creatorUpdates: Record<string, unknown> = {};
    if (updates.name) creatorUpdates.display_name = updates.name;
    if (updates.primary_image !== undefined) creatorUpdates.avatar_url = updates.primary_image;
    if (updates.bio !== undefined) creatorUpdates.bio = updates.bio;

    if (Object.keys(creatorUpdates).length > 0) {
      await supabase
        .from('creators')
        .update(creatorUpdates)
        .eq('id', model.creator_id);
    }
  }

  return { error: null };
}

export async function deleteAiModel(id: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };

  const { error } = await supabase
    .from('ai_models')
    .update({ status: 'archived', enabled: false })
    .eq('id', id);

  if (error) return { error: error.message };
  return { error: null };
}

export async function uploadFaceImage(file: File, modelSlug: string): Promise<{ url: string | null; error: string | null }> {
  if (!supabase) return { url: null, error: 'Supabase not configured' };

  const ext = file.name.split('.').pop() || 'jpg';
  const timestamp = Date.now();
  const path = `ai-models/${modelSlug}/${timestamp}.${ext}`;

  const { error } = await supabase.storage
    .from('look-media')
    .upload(path, file, { contentType: file.type });

  if (error) return { url: null, error: error.message };

  const { data: urlData } = supabase.storage
    .from('look-media')
    .getPublicUrl(path);

  return { url: urlData.publicUrl, error: null };
}
