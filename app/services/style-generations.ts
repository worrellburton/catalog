import { supabase } from '~/utils/supabase';

export type StyleGenerationStatus = 'pending' | 'generating' | 'done' | 'failed';
export type StyleImageProvider = 'gpt-image-1' | 'gpt-image-2' | 'nano-banana-2';
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
  liked: boolean;
  created_at: string;
}

export interface StyleGenerationResult {
  generation: StyleGeneration;
  images: StyleGenerationImage[];
}

/**
 * Insert a new style_generations row, then invoke the generate-style edge
 * function. The edge function seeds 4 'pending' image rows, kicks the slow
 * fal.ai work into a background task, and returns IMMEDIATELY with the
 * 'generating' parent + those pending rows — so this call resolves in ~1s
 * instead of being held open for 30-150s (which the browser killed mid-flight,
 * surfacing a false "Failed to send a request to the Edge Function").
 *
 * The caller renders the returned pending tiles (spinners) and then calls
 * `pollStyleGeneration` to watch the rows fill in.
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
    .select('id')
    .single();
  if (insertErr || !row) return { data: null, error: insertErr?.message ?? 'Failed to create generation' };

  const { data: invokeData, error: invokeErr } = await supabase.functions.invoke('generate-style', {
    body: { generation_id: row.id },
  });
  if (invokeErr) return { data: null, error: invokeErr.message };
  return { data: invokeData as StyleGenerationResult, error: null };
}

/** A style generation reached a terminal state once it's done or failed. */
function isTerminalStatus(status: StyleGenerationStatus): boolean {
  return status === 'done' || status === 'failed';
}

/**
 * Poll a generation until it reaches a terminal status (done|failed) or the
 * timeout elapses. `onSnapshot` fires on every successful read so the UI can
 * fill tiles as each image lands. Returns the final snapshot; `error` is set
 * only when the generation itself failed (a timeout returns the latest
 * snapshot with no error so the spinners simply persist).
 */
export async function pollStyleGeneration(
  generationId: string,
  opts: {
    onSnapshot?: (result: StyleGenerationResult) => void;
    intervalMs?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<{ data: StyleGenerationResult | null; error: string | null }> {
  const intervalMs = opts.intervalMs ?? 2500;
  // gpt-image-2 fan-outs have run as long as ~156s; give generous headroom.
  const timeoutMs = opts.timeoutMs ?? 240_000;
  const startedAt = Date.now();
  let latest: StyleGenerationResult | null = null;

  while (!opts.signal?.aborted) {
    const snap = await getStyleGenerationDetail(generationId);
    if (snap) {
      latest = snap;
      opts.onSnapshot?.(snap);
      if (isTerminalStatus(snap.generation.status)) {
        return {
          data: snap,
          error: snap.generation.status === 'failed'
            ? (snap.generation.error ?? 'Generation failed')
            : null,
        };
      }
    }
    if (Date.now() - startedAt > timeoutMs) return { data: latest, error: null };
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return { data: latest, error: null };
}

/** List a user's prior style generations (newest first). Used for history UI. */
export async function listStyleGenerations(userId: string): Promise<StyleGeneration[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('style_generations')
    .select('id, user_id, status, occasion, gender, name, height_label, age_label, resolved_prompt, reference_urls, error, created_at, completed_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) {
    console.error('[listStyleGenerations]', error.message);
    return [];
  }
  return (data ?? []) as StyleGeneration[];
}

/**
 * Hydrate a user's prior style generations together with their image
 * rows in two queries (one for the parents, one IN-list for the
 * children) so the Style page can render the full history without N+1.
 */
export async function listStyleGenerationsWithImages(
  userId: string,
): Promise<StyleGenerationResult[]> {
  if (!supabase) return [];
  const parents = await listStyleGenerations(userId);
  if (parents.length === 0) return [];
  const { data: images } = await supabase
    .from('style_generation_images')
    .select('id, generation_id, provider, sort_order, status, image_url, error, liked, created_at')
    .in('generation_id', parents.map(p => p.id))
    .order('sort_order');
  const byParent = new Map<string, StyleGenerationImage[]>();
  ((images ?? []) as StyleGenerationImage[]).forEach(img => {
    const list = byParent.get(img.generation_id) ?? [];
    list.push(img);
    byParent.set(img.generation_id, list);
  });
  return parents.map(p => ({ generation: p, images: byParent.get(p.id) ?? [] }));
}

/**
 * Delete a generation. The FK on style_generation_images is ON DELETE
 * CASCADE, so the 4 image rows go with it. RLS allows owners only.
 */
export async function deleteStyleGeneration(
  generationId: string,
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase
    .from('style_generations')
    .delete()
    .eq('id', generationId);
  return { error: error?.message ?? null };
}

/**
 * Delete a single image row. RLS gates this to the parent generation's
 * owner via the `style_generation_images_owner_delete` policy.
 */
export async function deleteStyleGenerationImage(
  imageId: string,
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase
    .from('style_generation_images')
    .delete()
    .eq('id', imageId);
  return { error: error?.message ?? null };
}

/**
 * Toggle the heart on a single image. Owner-gated via the
 * `style_generation_images_owner_update` RLS policy.
 */
export async function setStyleImageLiked(
  imageId: string,
  liked: boolean,
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase
    .from('style_generation_images')
    .update({ liked })
    .eq('id', imageId);
  return { error: error?.message ?? null };
}

/** Fetch a single generation + its images. Useful for re-rendering history. */
export async function getStyleGenerationDetail(
  generationId: string,
): Promise<StyleGenerationResult | null> {
  if (!supabase) return null;
  const [{ data: gen }, { data: images }] = await Promise.all([
    supabase.from('style_generations').select('id, user_id, status, occasion, gender, name, height_label, age_label, resolved_prompt, reference_urls, error, created_at, completed_at').eq('id', generationId).single(),
    supabase.from('style_generation_images').select('id, generation_id, provider, sort_order, status, image_url, error, liked, created_at').eq('generation_id', generationId).order('sort_order'),
  ]);
  if (!gen) return null;
  return {
    generation: gen as StyleGeneration,
    images: (images ?? []) as StyleGenerationImage[],
  };
}
