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
  { value: 'commercial',  label: 'Commercial',  blurb: 'Branded ad starring you — house-style spot per the picked brand' },
  { value: 'lifestyle',   label: 'Lifestyle',   blurb: 'Casual home / cafe setting, warm tones' },
  { value: 'studio',      label: 'Studio',      blurb: 'Clean seamless backdrop, product-focused' },
  { value: 'athletic',    label: 'Athletic',    blurb: 'Gym or outdoor training, dynamic motion' },
  { value: 'evening',     label: 'Evening',     blurb: 'Night out, bokeh city lights' },
  { value: 'beach',       label: 'Beach',       blurb: 'Coastal, golden hour, breeze' },
  { value: 'cinematic',   label: 'Cinematic',   blurb: 'Film look, shallow depth of field' },
];

/**
 * House-style hint per brand. Used by the Commercial style preset so a
 * picked Nike product produces a kinetic Nike-style spot, a Gap pick
 * lands a sunlit family Gap spot, etc. Order matters — earlier
 * patterns win, so put more specific brands first if any overlap.
 *
 * The tone string is dropped verbatim into the prompt, so phrase it
 * as a stack of visual cues Seedance can take literally.
 */
const BRAND_COMMERCIAL_TONES: { match: RegExp; key: string; tone: string }[] = [
  { match: /\bnike\b/i,                key: 'Nike',           tone: 'kinetic athletic spot, cinematic slow-mo + sprint, sweat + chalk, bold black-on-white captions, hero stadium or city street' },
  { match: /\badidas\b/i,              key: 'Adidas',         tone: 'street-athletic spot, three-stripe geometry, urban grit, concrete + neon, energetic crossfade' },
  { match: /\blululemon\b/i,           key: 'Lululemon',      tone: 'serene studio mat spot, soft daylight, calm breath-led pacing, neutral palette' },
  { match: /\bunder\s*armour\b/i,      key: 'Under Armour',   tone: 'gritty training spot, low-key lighting, intense close-ups, locker-room blacks' },
  { match: /\bpuma\b/i,                key: 'Puma',           tone: 'high-energy track spot, motion blur, vibrant primaries' },
  { match: /\breebok\b/i,              key: 'Reebok',         tone: 'retro athletic spot, warm grain, chalk and steel' },
  { match: /\bgap\b/i,                 key: 'Gap',            tone: 'warm Americana family spot, sunlit denim + tees, optimistic pop, casual choreography, light folk soundtrack feel' },
  { match: /\blevi'?s?\b/i,            key: "Levi's",         tone: 'Americana denim spot, sunset gold, dust, classic blue, warehouse + open road' },
  { match: /\bralph\s*lauren\b/i,      key: 'Ralph Lauren',   tone: 'East-Coast estate spot, polo greens + cream, golden hour Hamptons, prep choreography' },
  { match: /\bbrooks\s*brothers\b/i,   key: 'Brooks Brothers',tone: 'classic American tailoring spot, oak-paneled rooms, navy and oxford' },
  { match: /\btommy\s*hilfiger\b/i,    key: 'Tommy Hilfiger', tone: 'red-white-blue Americana spot, varsity prep, optimistic and bright' },
  { match: /\blacoste\b/i,             key: 'Lacoste',        tone: "Côte d'Azur tennis spot, white linen, clay courts, Mediterranean sun" },
  { match: /\buniqlo\b/i,              key: 'Uniqlo',         tone: 'clean Tokyo-grid spot, primary blocks, simple geometry, calm minimal pacing' },
  { match: /\bzara\b/i,                key: 'Zara',           tone: 'minimal editorial spot, concrete sets, monochrome wardrobe, slow turns' },
  { match: /\bh&m\b|\bhennes\b/i,      key: 'H&M',            tone: 'high-street pop spot, candy lighting, fast cuts, youthful' },
  { match: /\bpatagonia\b/i,           key: 'Patagonia',      tone: 'wild-outdoors spot, mountain weather, alpine grit, documentary feel' },
  { match: /\bnorth\s*face\b/i,        key: 'The North Face', tone: 'expedition spot, snow + rock, technical layers, breath in cold air' },
  { match: /\bcolumbia\b/i,            key: 'Columbia',       tone: 'rugged trail spot, river crossings, gear-forward composition' },
  { match: /\bvans\b/i,                key: 'Vans',           tone: 'skate-park spot, daylight warehouse, handheld energy, halfpipe arcs' },
  { match: /\bconverse\b/i,            key: 'Converse',       tone: 'analog music-video spot, brick walls, low warm tungsten' },
  { match: /\bnew\s*balance\b/i,       key: 'New Balance',    tone: 'understated dad-core spot, tarmac, warm grade, restrained pacing' },
  { match: /\bchanel\b/i,              key: 'Chanel',         tone: 'Parisian luxury spot, sculptural monochrome, marble + gold, hushed elegance' },
  { match: /\bdior\b/i,                key: 'Dior',           tone: 'haute couture spot, painterly light, draped fabric in motion' },
  { match: /\bgucci\b/i,               key: 'Gucci',          tone: 'maximalist editorial spot, jewel tones, theatrical sets, surreal pacing' },
  { match: /\bprada\b/i,               key: 'Prada',          tone: 'austere conceptual spot, hard angles, cool palette, deliberate pacing' },
  { match: /\bbalenciaga\b/i,          key: 'Balenciaga',     tone: 'subversive luxury spot, dystopian sets, hyper-saturated color' },
  { match: /\bversace\b/i,             key: 'Versace',        tone: 'gold-medusa Miami spot, marble columns, baroque richness' },
  { match: /\bcalvin\s*klein\b/i,      key: 'Calvin Klein',   tone: 'minimal monochrome spot, intimate close-ups, stark loft' },
  { match: /\barit\s*zia\b/i,          key: 'Aritzia',        tone: 'elevated everyday spot, soft neutrals, slow-mo turn, gauzy daylight' },
  { match: /\babercrombie\b/i,         key: 'Abercrombie',    tone: 'sun-drenched coastal spot, pier and dunes, denim and white tees' },
  { match: /\bj\.?crew\b/i,            key: 'J.Crew',         tone: 'preppy New England spot, sailboat blues, knit and oxford layers' },
  { match: /\bmadewell\b/i,            key: 'Madewell',       tone: 'lived-in denim spot, warm warehouse, hand-held intimacy' },
  { match: /\bbanana\s*republic\b/i,   key: 'Banana Republic',tone: 'modern safari spot, neutral camel and stone, golden hour' },
  { match: /\bapple\b/i,               key: 'Apple',          tone: 'minimalist white-room spot, clean motion, hero shot, kinetic typography' },
  { match: /\btesla\b/i,               key: 'Tesla',          tone: 'minimalist tech spot, polished concrete, monochrome hero, kinetic reveal' },
];

interface BrandTone { key: string; tone: string }

function detectBrandTones(
  productLines: { brand: string | null }[],
): BrandTone[] {
  const seen = new Map<string, BrandTone>();
  for (const p of productLines) {
    const brand = (p.brand ?? '').trim();
    if (!brand) continue;
    const hit = BRAND_COMMERCIAL_TONES.find(b => b.match.test(brand));
    if (hit) {
      if (!seen.has(hit.key)) seen.set(hit.key, { key: hit.key, tone: hit.tone });
    } else {
      if (!seen.has(brand)) {
        seen.set(brand, {
          key: brand,
          tone: `${brand} house-style spot, hero pacing, on-brand palette, polished grade`,
        });
      }
    }
  }
  return Array.from(seen.values());
}

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

/**
 * Delete one of the user's reference photos. Removes the storage object
 * (best-effort — bucket cleanup is non-blocking) and the row, which
 * cascades into any user_generation_uploads entries that referenced it.
 */
export async function deleteUserUpload(
  upload: Pick<UserUpload, 'id' | 'storage_path'>,
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  if (upload.storage_path) {
    await supabase.storage.from('user-uploads').remove([upload.storage_path]);
  }
  const { error } = await supabase.from('user_uploads').delete().eq('id', upload.id);
  return { error: error?.message ?? null };
}

/**
 * Delete a single generation. Cascades into the pivots; the rendered
 * Seedance video stays in storage (we only own user-uploaded refs, the
 * output URL points at Fal's CDN), so we just drop the row.
 */
export async function deleteUserGeneration(id: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase.from('user_generations').delete().eq('id', id);
  return { error: error?.message ?? null };
}

/**
 * Fetch the shopper's saved reference-photo slot picks. Returns an
 * ordered array of upload ids (always length 3, with `null` for any
 * empty slot). When the row hasn't been created yet, returns three
 * nulls.
 */
export async function getUserSlots(
  userId: string,
  size = 3,
): Promise<(string | null)[]> {
  const empty = Array<string | null>(size).fill(null);
  if (!supabase) return empty;
  const { data, error } = await supabase
    .from('user_generation_slots')
    .select('upload_ids')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return empty;
  const ids = (data.upload_ids ?? []) as (string | null)[];
  const padded = empty.slice();
  ids.slice(0, size).forEach((id, i) => { padded[i] = id ?? null; });
  return padded;
}

/**
 * Persist the shopper's picked slots. Upserts so the first save
 * creates the row and subsequent saves overwrite it.
 */
export async function saveUserSlots(
  userId: string,
  slots: (string | null)[],
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  // Trim trailing empty slots so the array matches what the user
  // actually picked. Mid-array nulls are preserved (uuid[] allows
  // null elements) so a pick in slot 2 with slot 1 empty rehydrates
  // back to the same position next session.
  const trimmed = [...slots];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] == null) trimmed.pop();
  const { error } = await supabase
    .from('user_generation_slots')
    .upsert(
      {
        user_id: userId,
        upload_ids: trimmed,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
  return { error: error?.message ?? null };
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
 *
 * The `commercial` style takes a different shape: it casts the shopper as
 * the lead in a brand-house-style spot. When products span multiple
 * brands the prompt asks for a crossover/mesh of those tones (e.g. a
 * Nike × Gap collab spot meshes kinetic athletic energy with sunlit
 * Americana family warmth).
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

  const ageClause = opts.ageLabel ? ` They look ${opts.ageLabel}.` : '';

  if (opts.style === 'commercial') {
    const tones = detectBrandTones(opts.productLines);
    let castLine: string;
    if (tones.length === 0) {
      castLine = 'Cast them as the lead in a polished branded commercial — hero pacing, clean grade, on-brand palette.';
    } else if (tones.length === 1) {
      castLine = `Cast them as the lead in a ${tones[0].key} commercial — ${tones[0].tone}.`;
    } else {
      const names = tones.map(t => t.key).join(' × ');
      const blendedTone = tones.map(t => t.tone).join('; meshing ');
      castLine = `Cast them as the lead in a ${names} crossover commercial — meshing ${blendedTone}. Frame it as an unmistakable collab spot, blending each brand's house style into one cohesive look.`;
    }
    return [
      `Use this person's face. Make them ${opts.heightLabel} tall.${ageClause}`,
      productList ? `Hero products on body: ${productList}.` : 'Hero the provided products on body.',
      castLine,
      '5-second portrait clip, hero pacing, polished commercial grade.',
    ].join(' ');
  }

  const styleTag = stylePreset ? `, ${stylePreset.label.toLowerCase()} vibe` : '';

  return [
    `Use this person's face. Make them ${opts.heightLabel} tall.${ageClause}`,
    productList ? `Put these products on them: ${productList}.` : 'Put the provided products on them.',
    `Natural motion, 5-second portrait clip${styleTag}.`,
  ].join(' ');
}
