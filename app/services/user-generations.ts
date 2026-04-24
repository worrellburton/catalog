import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '~/utils/supabase';

export interface UserUpload {
  id: string;
  user_id: string;
  storage_path: string;
  public_url: string;
  mime_type: string | null;
  byte_size: number | null;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface UserGeneration {
  id: string;
  user_id: string;
  status: 'pending' | 'generating' | 'done' | 'failed';
  height_cm: number | null;
  height_label: string | null;
  age_label: string | null;
  style: string;
  prompt: string | null;
  veo_model: string | null;
  video_url: string | null;
  storage_path: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface GenerationProduct {
  product_id: string;
  role_tag: string | null;
  sort_order: number;
}

// Eight preset styles — the Generate page dropdown picks one of these; the
// prompt builder concatenates the label into the Seedance instruction.
export const STYLE_PRESETS: { value: string; label: string; blurb: string }[] = [
  { value: 'street',      label: 'Street',      blurb: 'Urban candid, natural light, walking shot' },
  { value: 'editorial',   label: 'Editorial',   blurb: 'High-fashion studio, dramatic lighting' },
  { value: 'lifestyle',   label: 'Lifestyle',   blurb: 'Casual home / cafe setting, warm tones' },
  { value: 'studio',      label: 'Studio',      blurb: 'Clean seamless backdrop, product-focused' },
  { value: 'athletic',    label: 'Athletic',    blurb: 'Gym or outdoor training, dynamic motion' },
  { value: 'evening',     label: 'Evening',     blurb: 'Night out, bokeh city lights' },
  { value: 'beach',       label: 'Beach',       blurb: 'Coastal, golden hour, breeze' },
  { value: 'cinematic',   label: 'Cinematic',   blurb: 'Film look, shallow depth of field' },
];

/**
 * Upload one reference photo for the current user. Objects land under
 * `<uid>/<timestamp>-<random>.<ext>` so the bucket RLS (which keys off the
 * first folder) keeps each shopper siloed.
 *
 * When `onProgress` is provided, we POST directly to the Storage REST API
 * via XHR — `fetch()` (which supabase-js uses internally) doesn't expose
 * request-upload progress in any browser today. The XHR path uses the
 * exact same Authorization + apikey headers supabase-js attaches, so RLS
 * still applies. Without `onProgress` we fall back to supabase-js so we
 * inherit any future retry/transport tweaks they ship.
 */
export async function uploadUserPhoto(
  file: File,
  userId: string,
  onProgress?: (pct: number) => void,
): Promise<{ data: UserUpload | null; error: string | null }> {
  if (!supabase) return { data: null, error: 'Supabase not configured' };

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const bucket = 'user-uploads';

  if (onProgress) {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return { data: null, error: 'Not signed in' };

    const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`;
    const xhrErr = await new Promise<string | null>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      // Storage REST requires both Authorization and the apikey header
      // (the anon key) regardless of whether the user is authed.
      xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.setRequestHeader('cache-control', '3600');
      if (file.type) xhr.setRequestHeader('content-type', file.type);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.min(0.99, e.loaded / e.total));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) { onProgress(1); resolve(null); }
        else resolve(`Upload failed (HTTP ${xhr.status})`);
      };
      xhr.onerror = () => resolve('Network error during upload');
      xhr.onabort = () => resolve('Upload aborted');
      xhr.send(file);
    });
    if (xhrErr) return { data: null, error: xhrErr };
  } else {
    const { error: uploadErr } = await supabase.storage
      .from(bucket)
      .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });
    if (uploadErr) return { data: null, error: uploadErr.message };
  }

  const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path);

  const { data, error } = await supabase
    .from('user_uploads')
    .insert({
      user_id: userId,
      storage_path: path,
      public_url: publicUrl,
      mime_type: file.type || null,
      byte_size: file.size || null,
    })
    .select('*')
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as UserUpload, error: null };
}

export async function listUserUploads(userId: string): Promise<UserUpload[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('user_uploads')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[listUserUploads]', error.message);
    return [];
  }
  return (data || []) as UserUpload[];
}

export interface CreateGenerationInput {
  userId: string;
  uploadIds: string[];
  products: GenerationProduct[];
  heightCm: number;
  heightLabel: string;
  ageLabel: string;
  style: string;
  prompt: string;
}

/**
 * Persist a single Generate submission. Writes the parent row + both pivot
 * tables in sequence — wrapped in try/rollback so the edge function never
 * sees a half-built job. Status starts at 'pending'; the generate-look
 * edge function promotes it through generating → done|failed.
 */
export async function createGeneration(
  input: CreateGenerationInput,
): Promise<{ data: UserGeneration | null; error: string | null }> {
  if (!supabase) return { data: null, error: 'Supabase not configured' };

  const { data: gen, error: genErr } = await supabase
    .from('user_generations')
    .insert({
      user_id: input.userId,
      status: 'pending',
      height_cm: input.heightCm,
      height_label: input.heightLabel,
      age_label: input.ageLabel,
      style: input.style,
      prompt: input.prompt,
    })
    .select('*')
    .single();

  if (genErr || !gen) return { data: null, error: genErr?.message || 'Failed to create generation' };

  const uploadRows = input.uploadIds.map((upload_id, i) => ({
    generation_id: gen.id, upload_id, sort_order: i,
  }));
  if (uploadRows.length > 0) {
    const { error } = await supabase.from('user_generation_uploads').insert(uploadRows);
    if (error) {
      await supabase.from('user_generations').delete().eq('id', gen.id);
      return { data: null, error: error.message };
    }
  }

  const productRows = input.products.map((p, i) => ({
    generation_id: gen.id,
    product_id: p.product_id,
    role_tag: p.role_tag,
    sort_order: p.sort_order ?? i,
  }));
  if (productRows.length > 0) {
    const { error } = await supabase.from('user_generation_products').insert(productRows);
    if (error) {
      await supabase.from('user_generations').delete().eq('id', gen.id);
      return { data: null, error: error.message };
    }
  }

  // Fire-and-forget: kick the generate-look edge function so the poller
  // doesn't have to wait for a cron to pick the pending row up. We ignore
  // the promise — the row is already persisted and polling handles the
  // terminal state regardless of whether invoke resolves cleanly.
  supabase.functions.invoke('generate-look', {
    body: { generation_id: gen.id },
  }).catch(err => console.error('[createGeneration] invoke failed:', err));

  return { data: gen as UserGeneration, error: null };
}

export async function getGeneration(id: string): Promise<UserGeneration | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('user_generations').select('*').eq('id', id).single();
  if (error) return null;
  return data as UserGeneration;
}

export async function listUserGenerations(userId: string): Promise<UserGeneration[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from('user_generations')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return (data || []) as UserGeneration[];
}

export interface GenerationProductDetail {
  product_id: string;
  role_tag: string | null;
  sort_order: number;
  product: {
    id: string;
    name: string | null;
    brand: string | null;
    price: string | null;
    image_url: string | null;
  } | null;
}

export interface GenerationDetail {
  generation: UserGeneration | null;
  uploadIds: string[];
  uploads: UserUpload[];
  products: GenerationProductDetail[];
}

/**
 * Hydrate a single generation with its linked uploads and picked products,
 * so the Generate page can pre-fill the wizard for "edit & regenerate".
 */
export async function getGenerationDetail(id: string): Promise<GenerationDetail> {
  const empty: GenerationDetail = { generation: null, uploadIds: [], uploads: [], products: [] };
  if (!supabase) return empty;

  const [genRes, uploadsRes, productsRes] = await Promise.all([
    supabase.from('user_generations').select('*').eq('id', id).single(),
    supabase
      .from('user_generation_uploads')
      .select('upload_id, sort_order, user_uploads(*)')
      .eq('generation_id', id)
      .order('sort_order'),
    supabase
      .from('user_generation_products')
      .select('product_id, role_tag, sort_order, products(id, name, brand, price, image_url)')
      .eq('generation_id', id)
      .order('sort_order'),
  ]);

  const generation = (genRes.data ?? null) as UserGeneration | null;

  // Supabase types joined FK targets as arrays even for single-FK joins; at
  // runtime they come through as a single object (or null). Cast through
  // `unknown` so TS trusts the shape we actually receive.
  const uploadRows = (uploadsRes.data || []) as unknown as Array<{
    upload_id: string;
    sort_order: number;
    user_uploads: UserUpload | null;
  }>;
  const uploadIds = uploadRows.map(r => r.upload_id);
  const uploads = uploadRows.map(r => r.user_uploads).filter((u): u is UserUpload => !!u);

  const products = ((productsRes.data || []) as unknown as Array<{
    product_id: string;
    role_tag: string | null;
    sort_order: number;
    products: GenerationProductDetail['product'];
  }>).map(r => ({
    product_id: r.product_id,
    role_tag: r.role_tag,
    sort_order: r.sort_order,
    product: r.products,
  }));

  return { generation, uploadIds, uploads, products };
}

/**
 * Build the Seedance reference-to-video prompt. Kept deliberately short —
 * Seedance 2 Fast's reference endpoint is fed the face + product photos as
 * visual references, so the text only needs to tell it *what to do*:
 * preserve the face, set the height, place the products on the subject.
 */
export function buildGenerationPrompt(opts: {
  heightLabel: string;
  ageLabel?: string;
  style: string;
  productLines: { role_tag: string | null; brand: string | null; name: string | null }[];
}): string {
  const stylePreset = STYLE_PRESETS.find(s => s.value === opts.style);
  const productList = opts.productLines
    .map(p => {
      const name = [p.brand, p.name].filter(Boolean).join(' ').trim();
      if (p.role_tag && name) return `${p.role_tag.toLowerCase()} (${name})`;
      return p.role_tag?.toLowerCase() || name || 'product';
    })
    .filter(Boolean)
    .join(', ');

  const styleTag = stylePreset ? `, ${stylePreset.label.toLowerCase()} vibe` : '';
  const ageClause = opts.ageLabel ? ` They look ${opts.ageLabel}.` : '';

  return [
    `Use this person's face. Make them ${opts.heightLabel} tall.${ageClause}`,
    productList ? `Put these products on them: ${productList}.` : 'Put the provided products on them.',
    `Natural motion, 5-second portrait clip${styleTag}.`,
  ].join(' ');
}
