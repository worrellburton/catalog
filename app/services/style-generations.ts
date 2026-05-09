import { supabase } from '~/utils/supabase';

export type StyleGenerationStatus = 'pending' | 'generating' | 'done' | 'failed';
export type StyleImageProvider = 'gpt-image-1' | 'nano-banana-2';
export type StyleImageStatus = 'pending' | 'done' | 'failed';

export interface StyleGeneration {
  id: string;
  user_id: string;
  status: StyleGenerationStatus;
  occasion: string;
  gender: string | null;
  name: string | null;
  height_label: string | null;
  age_label: string | null;
  resolved_prompt: string | null;
  reference_urls: string[];
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface StyleGenerationImage {
  id: string;
  generation_id: string;
  provider: StyleImageProvider;
  sort_order: number;
  status: StyleImageStatus;
  image_url: string | null;
  error: string | null;
  created_at: string;
}

export interface StyleGenerationResult {
  generation: StyleGeneration;
  images: StyleGenerationImage[];
}

/**
 * Insert a new style_generations row, then invoke the generate-style edge
 * function. The edge function blocks until all 4 fal.ai calls settle and
 * returns the populated parent row + image rows in one shot, so the caller
 * doesn't need to poll.
 */
export async function createStyleGeneration(input: {
  userId: string;
  occasion: string;
  referenceUrls: string[];
}): Promise<{ data: StyleGenerationResult | null; error: string | null }> {
  if (!supabase) return { data: null, error: 'Supabase not configured' };
  const occasion = input.occasion.trim();
  if (!occasion) return { data: null, error: 'Tell us what you want to be styled for.' };
  if (input.referenceUrls.length === 0) return { data: null, error: 'Add a photo on the Try it on page first.' };

  const { data: row, error: insertErr } = await supabase
    .from('style_generations')
    .insert({
      user_id: input.userId,
      occasion,
      reference_urls: input.referenceUrls,
      status: 'pending',
    })
    .select('*')
    .single();
  if (insertErr || !row) return { data: null, error: insertErr?.message ?? 'Failed to create generation' };

  const { data: invokeData, error: invokeErr } = await supabase.functions.invoke('generate-style', {
    body: { generation_id: row.id },
  });
  if (invokeErr) return { data: null, error: invokeErr.message };
  return { data: invokeData as StyleGenerationResult, error: null };
}

/** List a user's prior style generations (newest first). Used for history UI. */
export async function listStyleGenerations(userId: string): Promise<StyleGeneration[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('style_generations')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) {
    console.error('[listStyleGenerations]', error.message);
    return [];
  }
  return (data ?? []) as StyleGeneration[];
}

/** Fetch a single generation + its images. Useful for re-rendering history. */
export async function getStyleGenerationDetail(
  generationId: string,
): Promise<StyleGenerationResult | null> {
  if (!supabase) return null;
  const [{ data: gen }, { data: images }] = await Promise.all([
    supabase.from('style_generations').select('*').eq('id', generationId).single(),
    supabase.from('style_generation_images').select('*').eq('generation_id', generationId).order('sort_order'),
  ]);
  if (!gen) return null;
  return {
    generation: gen as StyleGeneration,
    images: (images ?? []) as StyleGenerationImage[],
  };
}
