import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '~/utils/supabase';

// Resolve the published/promoted look that a completed generation became,
// so the "Your looks" rail can deep-link a finished render to its look
// screen. Every completed generation auto-lands as a look with
// source_generation_id pointing back here; returns that look's uuid (or
// null if it hasn't been promoted yet).
export async function getLookUuidForGeneration(genId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('looks')
    .select('id')
    .eq('source_generation_id', genId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

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
  /** Frozen weight phrase ("165 lb (75 kg)") captured at submit time;
   *  null for legacy rows that pre-date the column. */
  weight_label: string | null;
  style: string;
  prompt: string | null;
  veo_model: string | null;
  video_url: string | null;
  storage_path: string | null;
  error: string | null;
  duration_seconds: number;
  model: 'fast' | 'pro';
  crop_scale: number;
  crop_x: number;
  crop_y: number;
  created_at: string;
  completed_at: string | null;
  /** Fal queue request_id. Surfaced on the failed-generation UI so we
   *  can grep edge-function logs for the exact webhook payload. */
  fal_request_id?: string | null;
  /** Claude-generated 2-4 word name for the look (e.g. "Linen Sunset").
   *  Populated by the name-look edge function fire-and-forget after a
   *  generation is created. Null until that round trip completes; the
   *  LookCard falls back to the style preset label in the meantime. */
  display_name: string | null;
  /** Machine-readable failure category (set by fal-webhook). e.g.
   *  'content_policy', 'no_face_detected', 'invalid_image'. UI keys off
   *  this to render an actionable hint. */
  error_code?: string | null;
  /** Full raw error string from Fal/ByteDance, kept for the Show details
   *  panel so we can debug exotic failures. */
  error_raw?: string | null;
  /** Auth.users.id of the admin who kicked this off via /generate?as_user=.
   *  Null for normal self-triggered shopper rows. The admin user detail
   *  page reads this to split the Generation queue into Admin / User. */
  triggered_by_admin_id?: string | null;
}

export interface GenerationProduct {
  product_id: string;
  role_tag: string | null;
  sort_order: number;
}

/**
 * A generation that has stayed non-terminal far longer than any real
 * render budget (~3 min for a 5s clip, ~6 min for 10s) is treated as
 * dead — the generate-look pipeline never reconciled it. 20 minutes is
 * comfortably past the slowest legitimate render while still clearing a
 * zombie row within the session.
 *
 * Used by the header pill and the grid LookCard so a stuck 'pending'
 * row stops haunting the UI (an endless "look is rendering" pill +
 * a card frozen at "Queued / 100%") and becomes deletable instead.
 */
export const GENERATION_STALE_MS = 20 * 60 * 1000;

/** True while a generation is genuinely mid-render — non-terminal AND
 *  not yet past the staleness cutoff. Stale zombie rows return false so
 *  the UI treats them as finished (failed) rather than in-flight. */
export function isGenerationInFlight(
  row: Pick<UserGeneration, 'status' | 'created_at'>,
): boolean {
  if (row.status === 'done' || row.status === 'failed') return false;
  return Date.now() - new Date(row.created_at).getTime() < GENERATION_STALE_MS;
}

// Eight preset styles - the Generate page dropdown picks one of these; the
// prompt builder concatenates the label into the Seedance instruction.
export const STYLE_PRESETS: { value: string; label: string; blurb: string }[] = [
  { value: 'street',      label: 'Street',      blurb: 'Urban candid, natural light, walking shot' },
  { value: 'editorial',   label: 'Editorial',   blurb: 'High-fashion studio, dramatic lighting' },
  { value: 'commercial',  label: 'Commercial',  blurb: 'Branded ad starring you - house-style spot per the picked brand' },
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
 * lands a sunlit family Gap spot, etc. Order matters - earlier
 * patterns win, so put more specific brands first if any overlap.
 *
 * The tone string is dropped verbatim into the prompt, so phrase it
 * as a stack of visual cues Seedance can take literally.
 */
// Per-brand commercial fingerprint. The `tone` carries the visual
// world (palette, set, wardrobe energy); `camera` carries the
// cinematography spine (camera moves, lens choice, beat structure)
// so Seedance produces something that reads like a commercial -- not
// a static fit-cam. Both strings drop verbatim into the prompt.
const BRAND_COMMERCIAL_TONES: { match: RegExp; key: string; tone: string; camera: string }[] = [
  { match: /\bnike\b/i,                key: 'Nike',
    tone:   'kinetic athletic spot, cinematic slow-mo + sprint, sweat + chalk, bold black-on-white captions, hero stadium or city street',
    camera: 'kinetic handheld + dolly, low-angle hero stride, whip pan into a tight close-up, snap zoom on the logo, motion-blur match cuts; sprint cadence' },
  { match: /\badidas\b/i,              key: 'Adidas',
    tone:   'street-athletic spot, three-stripe geometry, urban grit, concrete + neon, energetic crossfade',
    camera: 'low-angle Steadicam, sliding dolly past the subject, whip-pan transitions, neon rim-light flares' },
  { match: /\blululemon\b/i,           key: 'Lululemon',
    tone:   'serene studio mat spot, soft daylight, calm breath-led pacing, neutral palette',
    camera: 'slow gimbal arc, breath-paced dolly-in, rack-focus from hands to face; sustained holds, no whip cuts' },
  { match: /\bunder\s*armour\b/i,      key: 'Under Armour',
    tone:   'gritty training spot, low-key lighting, intense close-ups, locker-room blacks',
    camera: 'tight handheld, hard side-light, push-in on clenched detail, snap-cut to wide hero pose' },
  { match: /\bpuma\b/i,                key: 'Puma',
    tone:   'high-energy track spot, motion blur, vibrant primaries',
    camera: 'tracking dolly alongside motion, whip pans, color-saturated rim light, snap zoom' },
  { match: /\breebok\b/i,              key: 'Reebok',
    tone:   'retro athletic spot, warm grain, chalk and steel',
    camera: '35mm warm grain, ground-level dolly, slow-mo step beat at frame 2, freeze-frame hero pose' },
  { match: /\bgap\b/i,                 key: 'Gap',
    tone:   'warm Americana family spot, sunlit denim + tees, optimistic pop, casual choreography',
    camera: 'sun-flare push-in, mid-stride hero pose at frame 2, catching-the-light close-up at frame 3, slow turn-and-smile to camera' },
  { match: /\blevi'?s?\b/i,            key: "Levi's",
    tone:   'Americana denim spot, sunset gold, dust, classic blue, warehouse + open road',
    camera: 'low-angle hero stride, dust kick-up, golden-hour rim light, dolly + slow-mo step' },
  { match: /\bralph\s*lauren\b/i,      key: 'Ralph Lauren',
    tone:   'East-Coast estate spot, polo greens + cream, golden hour Hamptons, prep choreography',
    camera: 'wide composed frame, slow gimbal arc, soft golden flare; classical pacing with one push-in' },
  { match: /\bbrooks\s*brothers\b/i,   key: 'Brooks Brothers',
    tone:   'classic American tailoring spot, oak-paneled rooms, navy and oxford',
    camera: 'static composed wide, deliberate dolly-in to mid-shot, single rack focus to a tailoring detail' },
  { match: /\btommy\s*hilfiger\b/i,    key: 'Tommy Hilfiger',
    tone:   'red-white-blue Americana spot, varsity prep, optimistic and bright',
    camera: 'bright bounce-light, dolly-in past flag elements, snap cut to a smile-to-camera' },
  { match: /\blacoste\b/i,             key: 'Lacoste',
    tone:   "Côte d'Azur tennis spot, white linen, clay courts, Mediterranean sun",
    camera: 'low sun haze, slow dolly past clay, slow-mo serve beat, soft rack focus' },
  { match: /\buniqlo\b/i,              key: 'Uniqlo',
    tone:   'clean Tokyo-grid spot, primary blocks, simple geometry, calm minimal pacing',
    camera: 'static wide composed, single push-in, deliberate quarter-turn, no whip cuts' },
  { match: /\bzara\b/i,                key: 'Zara',
    tone:   'minimal editorial spot, concrete sets, monochrome wardrobe, slow turns',
    camera: 'studio dolly arc, hard side-light, slow turn-and-stare, single rack focus' },
  { match: /\bh&m\b|\bhennes\b/i,      key: 'H&M',
    tone:   'high-street pop spot, candy lighting, fast cuts, youthful',
    camera: 'fast push-ins, snap zooms, jump-cut feel via aggressive composition shifts, neon backlight' },
  { match: /\bpatagonia\b/i,           key: 'Patagonia',
    tone:   'wild-outdoors spot, mountain weather, alpine grit, documentary feel',
    camera: 'handheld documentary, wind-buffeted lens, wide-to-tight pull, breath in cold air close-up' },
  { match: /\bnorth\s*face\b/i,        key: 'The North Face',
    tone:   'expedition spot, snow + rock, technical layers',
    camera: 'wide alpine drone-feel, descend to handheld follow, breath-condensation close-up' },
  { match: /\bcolumbia\b/i,            key: 'Columbia',
    tone:   'rugged trail spot, river crossings, gear-forward composition',
    camera: 'low-angle hero stride through terrain, splash close-up, push-in on gear detail' },
  { match: /\bvans\b/i,                key: 'Vans',
    tone:   'skate-park spot, daylight warehouse, handheld energy',
    camera: 'fisheye energy, low-angle handheld follow, snap pan on board flick, freeze on landing' },
  { match: /\bconverse\b/i,            key: 'Converse',
    tone:   'analog music-video spot, brick walls, low warm tungsten',
    camera: 'handheld 16mm feel, swing-pan transitions, neon-tinged rim light, jump cut on beat' },
  { match: /\bnew\s*balance\b/i,       key: 'New Balance',
    tone:   'understated dad-core spot, tarmac, warm grade',
    camera: 'patient dolly alongside, warm grain, slow-mo footstrike close-up, single push-in to mid-shot' },
  { match: /\bchanel\b/i,              key: 'Chanel',
    tone:   'Parisian luxury spot, sculptural monochrome, marble + gold, hushed elegance',
    camera: 'slow gimbal arc around the subject, hard key + soft fill, deliberate rack focus, hushed pacing' },
  { match: /\bdior\b/i,                key: 'Dior',
    tone:   'haute couture spot, painterly light, draped fabric in motion',
    camera: 'slow dolly-in, fabric-flow slow-mo, rack focus from hands to eyes, painterly chiaroscuro' },
  { match: /\bgucci\b/i,               key: 'Gucci',
    tone:   'maximalist editorial spot, jewel tones, theatrical sets, surreal pacing',
    camera: 'symmetrical wide, slow zoom-in with theatrical pause, surreal dutch tilt, lush rack focus' },
  { match: /\bprada\b/i,               key: 'Prada',
    tone:   'austere conceptual spot, hard angles, cool palette, deliberate pacing',
    camera: 'hard fluorescent key, slow lateral dolly, deliberate quarter-turn, no whip cuts' },
  { match: /\bbalenciaga\b/i,          key: 'Balenciaga',
    tone:   'subversive luxury spot, dystopian sets, hyper-saturated color',
    camera: 'wide-anamorphic feel, slow zoom with menacing pause, hard composed frame, single drop-cut' },
  { match: /\bversace\b/i,             key: 'Versace',
    tone:   'gold-medusa Miami spot, marble columns, baroque richness',
    camera: 'slow orbit around the subject, gold-bounce key, rack focus on jewelry, slow tilt up to face' },
  { match: /\bcalvin\s*klein\b/i,      key: 'Calvin Klein',
    tone:   'minimal monochrome spot, intimate close-ups, stark loft',
    camera: 'tight handheld close-ups, hard side-light, slow dolly to mid-shot, sparse cuts via composition shift' },
  { match: /\barit\s*zia\b/i,          key: 'Aritzia',
    tone:   'elevated everyday spot, soft neutrals, gauzy daylight',
    camera: 'soft window light, slow gimbal turn, rack focus from fabric to eyes, slow-mo fabric move' },
  { match: /\babercrombie\b/i,         key: 'Abercrombie',
    tone:   'sun-drenched coastal spot, pier and dunes, denim and white tees',
    camera: 'sun-flare lens, low-angle hero, ocean wind-blown hair, slow turn-to-camera' },
  { match: /\bj\.?crew\b/i,            key: 'J.Crew',
    tone:   'preppy New England spot, sailboat blues, knit and oxford layers',
    camera: 'wide composed dock or porch, dolly-in to mid-shot, soft golden hour, single rack focus' },
  { match: /\bmadewell\b/i,            key: 'Madewell',
    tone:   'lived-in denim spot, warm warehouse, hand-held intimacy',
    camera: 'warm hand-held, intimate close-up of hands on denim, slow turn to mid-shot, soft window key' },
  { match: /\bbanana\s*republic\b/i,   key: 'Banana Republic',
    tone:   'modern safari spot, neutral camel and stone, golden hour',
    camera: 'wide-to-tight push-in, golden hour flare, slow gimbal walk, classical pacing' },
  { match: /\bapple\b/i,               key: 'Apple',
    tone:   'minimalist white-room spot, clean motion, hero shot, kinetic typography',
    camera: 'static white seamless, slow turntable rotation of subject, push-in to macro detail at frame 3, clean rack-focus cut to product hero' },
  { match: /\btesla\b/i,               key: 'Tesla',
    tone:   'minimalist tech spot, polished concrete, monochrome hero, kinetic reveal',
    camera: 'slow lateral dolly, single hard rim, push-in to detail, clean rack-focus reveal' },
];

interface BrandTone { key: string; tone: string; camera: string }

function detectBrandTones(
  productLines: { brand: string | null }[],
): BrandTone[] {
  const seen = new Map<string, BrandTone>();
  for (const p of productLines) {
    const brand = (p.brand ?? '').trim();
    if (!brand) continue;
    const hit = BRAND_COMMERCIAL_TONES.find(b => b.match.test(brand));
    if (hit) {
      if (!seen.has(hit.key)) seen.set(hit.key, { key: hit.key, tone: hit.tone, camera: hit.camera });
    } else {
      // Brand isn't in BRAND_COMMERCIAL_TONES. Fall back to a generic
      // commercial template - do NOT inject the brand name into the
      // prompt (Bytedance content moderation rejects naked brand
      // mentions and we don't have a curated visual language for this
      // brand anyway). Key the seen-map by brand so we still dedupe,
      // but the rendered prompt stays brand-neutral.
      if (!seen.has(brand)) {
        seen.set(brand, {
          key: brand,
          tone: 'polished house-style spot, hero pacing, on-brand palette, polished grade',
          camera: 'cinematic dolly-in, hero low-angle, single rack focus to product detail, motion-blur transition that reads as a cut',
        });
      }
    }
  }
  return Array.from(seen.values());
}

/**
 * Body-zone framing - derived from the picked role tags so the
 * generated clip only shows the regions where the user actually
 * picked an item. A shopper who picked just a hat + sweatshirt
 * gets a portrait crop instead of Seedance inventing pants and
 * shoes that weren't part of the look.
 *
 * Zones map roughly:
 *   head : Hat, Sunglasses
 *   neck : Scarf, (Jewelry)
 *   torso: Top, Jacket
 *   waist: Belt, (Pants/Skirt/Shorts/Dress also fall here)
 *   legs : Pants, Skirt, Shorts, Dress
 *   feet : Shoes
 *   hand : Bag, Watch
 */
type BodyZone = 'head' | 'neck' | 'torso' | 'waist' | 'legs' | 'feet' | 'hand';

const ROLE_ZONES: Record<string, BodyZone[]> = {
  hat: ['head'],
  sunglasses: ['head'],
  glasses: ['head'],
  scarf: ['neck'],
  top: ['torso'],
  jacket: ['torso'],
  coat: ['torso'],
  dress: ['torso', 'waist', 'legs'],
  pants: ['waist', 'legs'],
  shorts: ['waist', 'legs'],
  skirt: ['waist', 'legs'],
  belt: ['waist'],
  shoes: ['feet'],
  bag: ['hand'],
  watch: ['hand'],
  jewelry: ['head', 'neck', 'hand'],
  accessory: [],
};

/** Light name-based fallback when role_tag is null on a picked product. */
function inferRoleFromName(name: string | null): string | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (/\b(hat|cap|beanie|fedora|visor|bucket\s*hat)\b/.test(lower)) return 'hat';
  if (/\b(sunglass|shades|aviator)\b/.test(lower)) return 'sunglasses';
  if (/\b(scarf|stole|wrap|shawl)\b/.test(lower)) return 'scarf';
  if (/\b(jacket|coat|parka|blazer|bomber|puffer|trench)\b/.test(lower)) return 'jacket';
  if (/\b(dress|gown)\b/.test(lower)) return 'dress';
  if (/\b(skirt)\b/.test(lower)) return 'skirt';
  if (/\b(short|bermuda)\b/.test(lower)) return 'shorts';
  if (/\b(pant|trouser|chino|jean|denim|legging|jogger)\b/.test(lower)) return 'pants';
  if (/\b(belt)\b/.test(lower)) return 'belt';
  if (/\b(sneaker|trainer|shoe|boot|heel|loafer|sandal)\b/.test(lower)) return 'shoes';
  if (/\b(bag|tote|clutch|purse|backpack|handbag)\b/.test(lower)) return 'bag';
  if (/\b(watch|wristwatch)\b/.test(lower)) return 'watch';
  if (/\b(necklace|ring|earring|bracelet|chain|pendant)\b/.test(lower)) return 'jewelry';
  if (/\b(shirt|tee|top|sweater|hoodie|polo|henley|tank|sweatshirt|knit|cardigan)\b/.test(lower)) return 'top';
  return null;
}

/**
 * Pick a framing instruction based on which body zones the picked
 * products cover. The string lands verbatim in the prompt and tells
 * Seedance both what to show and what to omit.
 */
function computeFraming(
  productLines: { role_tag: string | null; name: string | null }[],
): string {
  const zones = new Set<BodyZone>();
  for (const p of productLines) {
    const role = ((p.role_tag || inferRoleFromName(p.name)) || '').toLowerCase().trim();
    if (!role) continue;
    const z = ROLE_ZONES[role];
    if (z) z.forEach(zone => zones.add(zone));
  }
  // No tags at all -> default to full body so Seedance has something
  // to compose around.
  if (zones.size === 0) {
    return 'Frame as a centered full-body shot, head to toe.';
  }

  const head  = zones.has('head');
  const neck  = zones.has('neck');
  const torso = zones.has('torso');
  const waist = zones.has('waist');
  const legs  = zones.has('legs');
  const feet  = zones.has('feet');
  const hand  = zones.has('hand');

  // Head-only - tight portrait. Crop tightly so Seedance can't invent
  // a torso or outfit underneath.
  if (head && !neck && !torso && !waist && !legs && !feet && !hand) {
    return 'Tight head-and-shoulders crop. Frame from above the head down to just below the collarbone. Do not render torso, waist, legs, or feet.';
  }

  // Head + neck (no torso) - slightly looser portrait so a necklace
  // or scarf reads.
  if ((head || neck) && !torso && !waist && !legs && !feet) {
    return 'Tight portrait crop from above the head to mid-chest. Do not render torso below the chest, waist, legs, or feet.';
  }

  // Torso (with or without head) and nothing below - half-body crop.
  if (torso && !waist && !legs && !feet) {
    return 'Half-body portrait crop, top of head to just below the chest. Do not render waist, legs, or feet.';
  }

  // Includes the waist zone but no legs/feet - mid-shot.
  if ((torso || head) && waist && !legs && !feet) {
    return 'Mid-shot crop, top of head to just below the waist. Do not render legs or feet.';
  }

  // Has legs but no shoes - show the bottom in full, down to BARE feet.
  // We deliberately render the whole leg (not an ankle crop) so the
  // featured bottom reads at full length; the wardrobe clause pins the
  // feet to bare (no invented footwear) instead of cropping them out.
  if (legs && !feet) {
    return 'Full-length shot, top of head down to the floor, showing bare feet — no footwear of any kind.';
  }

  // Has shoes but no legs/torso - feet/ankle crop.
  if (feet && !legs && !torso && !head) {
    return 'Feet-and-ankles crop. Hero the shoes; face is optional and should not dominate.';
  }

  // Hand-carry items only (e.g. just a bag) - hand/forearm crop.
  if (hand && !head && !torso && !legs && !feet) {
    return 'Hand-and-forearm crop showing how the item is carried. Face is optional.';
  }

  // Anything spanning torso through feet - full body.
  return 'Frame as a centered full-body shot, head to toe.';
}

/**
 * Product-only wardrobe instruction. The model wears ONLY the attached
 * products — no invented garments, layers, or branding. Whatever the
 * products don't cover is left in plain, neutral, unbranded basics so all
 * attention stays on the featured items (this is how we "maximise the
 * product"). Coverage is gender-aware and only described for zones that
 * are actually in frame, so it never fights the crop:
 *   - bottom picked, no top  -> torso is shown -> plain neutral bra/tank
 *   - bottom picked, no shoes -> legs shown to the floor -> bare feet
 *   - top-only / head-only looks crop below the chest, so no extra
 *     coverage is mentioned at all.
 */
function computeProductOnlyWardrobe(
  productLines: { role_tag: string | null; name: string | null }[],
  gender?: 'male' | 'female' | 'unknown' | null,
): string {
  const zones = new Set<BodyZone>();
  for (const p of productLines) {
    const role = ((p.role_tag || inferRoleFromName(p.name)) || '').toLowerCase().trim();
    const z = role ? ROLE_ZONES[role] : null;
    if (z) z.forEach(zone => zones.add(zone));
  }
  const hasTop = zones.has('torso');
  const hasBottom = zones.has('legs') || zones.has('waist');
  const hasShoes = zones.has('feet');

  const base = 'Dress them in ONLY the referenced products — no other clothing, outerwear, layering, accessories, logos, or prints.';

  // Neutral fillers, only for zones that the framing will actually show
  // (i.e. once there's a bottom, the torso + legs are in frame).
  const fillers: string[] = [];
  if (hasBottom && !hasTop) {
    fillers.push(
      gender === 'female'
        ? 'a plain seamless neutral-white bra (unbranded, no logos)'
        : gender === 'male'
          ? 'a bare torso or a plain unbranded white tank'
          : 'a plain unbranded neutral top',
    );
  }
  if (hasBottom && !hasShoes) {
    fillers.push('bare feet');
  }

  if (fillers.length === 0) return base;
  return `${base} Leave everything the products don't cover in plain, neutral, unbranded basics so the products stay the sole focus: ${fillers.join(', ')}.`;
}

/**
 * Upload one reference photo for the current user. Objects land under
 * `<uid>/<timestamp>-<random>.<ext>` so the bucket RLS (which keys off the
 * first folder) keeps each shopper siloed.
 *
 * When `onProgress` is provided, we POST directly to the Storage REST API
 * via XHR - `fetch()` (which supabase-js uses internally) doesn't expose
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
 * Pre-validate one or more reference photos against Fal/ByteDance
 * before starting a generation. Submits the image set as a minimal
 * Seedance job and polls the queue until ByteDance's safety filter
 * either approves it (status COMPLETED with a video) or rejects it
 * (status COMPLETED with `detail[]`).
 *
 * Important: ByteDance's `partner_validation_failed` filter only fires
 * for multi-image (2–3 photo) submissions - single-image checks
 * almost always pass even when the real multi-photo generation will
 * fail. Always pass the full set of currently-filled slots.
 *
 * Fails open: if the edge function can't be reached, returns ok=true
 * so a network hiccup doesn't block the user from submitting.
 *
 * Reasons returned when ok=false:
 *   partner_validation_failed  - ByteDance "real likeness" safety filter
 *   content_policy_violation   - NSFW / disallowed content
 *   no_face_detected
 *   blocked                    - generic Fal rejection
 *   network_error              - couldn't reach edge function
 */
export async function checkFacePhoto(
  imageUrls: string[],
  userId: string,
): Promise<{ ok: boolean; reason: string | null; detail: string | null }> {
  if (!supabase) return { ok: true, reason: null, detail: null };
  if (!imageUrls.length) return { ok: true, reason: null, detail: null };
  try {
    const { data, error } = await supabase.functions.invoke('check-face-photo', {
      body: { image_urls: imageUrls, user_id: userId },
    });
    if (error) {
      console.error('[checkFacePhoto] invoke error', error.message);
      return { ok: true, reason: null, detail: null }; // fail open
    }
    return {
      ok: data?.ok ?? true,
      reason: data?.reason ?? null,
      detail: data?.detail ?? null,
    };
  } catch (err) {
    console.error('[checkFacePhoto] unexpected error', err);
    return { ok: true, reason: null, detail: null }; // fail open
  }
}

/**
 * Delete one of the user's reference photos. Removes the storage object
 * (best-effort - bucket cleanup is non-blocking) and the row, which
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
 * Fire the name-look edge function for a generation. Best-effort  - 
 * returns silently on any failure (network, missing key, Claude rate
 * limit). The generation's display_name stays null and the LookCard
 * falls back to the style preset label.
 *
 * Called fire-and-forget right after createGeneration so the name lands
 * on the row by the time the user pops back to the Photos step.
 */
export async function nameLookForGeneration(generationId: string): Promise<void> {
  if (!supabase) return;
  try {
    const { error } = await supabase.functions.invoke('name-look', {
      body: { generation_id: generationId },
    });
    if (error) {
      console.warn('[name-look] invoke error:', error);
      // Log to generation_events so the timeline shows the naming failure.
      try {
        await supabase.from('generation_events')
          .insert({ generation_id: generationId, event: 'name_look_fail', payload: { error: String(error) } });
      } catch { /* best-effort, never throw */ }
    }
  } catch (err) {
    // Naming is decorative - never block the user on it.
    console.warn('[name-look] invoke exception:', err);
    try {
      await supabase.from('generation_events')
        .insert({ generation_id: generationId, event: 'name_look_fail', payload: { error: String(err) } });
    } catch { /* best-effort */ }
  }
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
 * Re-run a finished generation in place. Resets the user_generations
 * row back to status='pending' + clears video_url / fal_request_id /
 * error / completed_at, then invokes the generate-look edge function
 * so the worker picks it up. Same inputs (uploads, products, prompt,
 * style, model) — the row id stays the same, the source_generation_id
 * link on any associated looks row stays intact.
 *
 * After the worker completes, the user_generations.video_url updates.
 * The looks_creative row pointing at the old video is auto-rewritten
 * by the DB trigger looks_creative_sync_from_user_generations so the
 * consumer feed picks up the new video without the admin re-
 * publishing. The realtime channel on looks_creative then propagates
 * the change to every connected shopper tab.
 */
export async function regenerateUserGeneration(id: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error: resetErr } = await supabase
    .from('user_generations')
    .update({
      status: 'pending',
      video_url: null,
      fal_request_id: null,
      completed_at: null,
      error: null,
    })
    .eq('id', id);
  if (resetErr) return { error: resetErr.message };
  supabase.functions.invoke('generate-look', {
    body: { generation_id: id },
  }).then(({ error }) => {
    if (error) console.warn('[regenerateUserGeneration] invoke error:', error);
  }).catch(err => console.warn('[regenerateUserGeneration] invoke exception:', err));
  return { error: null };
}

/**
 * Flip is_published on a generation. The consumer feed (when wired to
 * surface user-generated looks) filters on this column so a generation
 * only goes public after the user explicitly opts in via the "How did I
 * do?" feedback bar on the result step.
 */
export async function setGenerationPublished(
  id: string,
  isPublished: boolean,
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase
    .from('user_generations')
    .update({ is_published: isPublished })
    .eq('id', id);
  return { error: error?.message ?? null };
}

/**
 * Persist the user's "How did I do?" feedback. `kind` is 'love' (looks
 * great) or 'off' (this is not it); reason is the optional free-text
 * the user typed when picking 'off'. Doesn't write a row for the
 * delete path because the row is gone by then.
 */
export async function setGenerationFeedback(
  id: string,
  kind: 'love' | 'off',
  reason?: string,
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase
    .from('user_generations')
    .update({ feedback_kind: kind, feedback_reason: reason ?? null })
    .eq('id', id);
  return { error: error?.message ?? null };
}

/**
 * Persist the display-time crop transform for a generation. Clamps
 * to the column check constraints so a slipped slider can't poison
 * the row.
 */
export async function updateGenerationCrop(
  id: string,
  crop: { scale: number; x: number; y: number },
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const scale = Math.max(1, Math.min(4, crop.scale));
  const x = Math.max(-1, Math.min(1, crop.x));
  const y = Math.max(-1, Math.min(1, crop.y));
  const { error } = await supabase
    .from('user_generations')
    .update({ crop_scale: scale, crop_x: x, crop_y: y })
    .eq('id', id);
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
  /** Frozen weight phrase the prompt should hear. Null/undefined when
   *  the user hasn't set a weight on their profile yet — the prompt
   *  builder omits the clause in that case rather than fabricating a
   *  number. Optional during the gradual rollout so existing call
   *  sites compile without forcing every caller to thread a value. */
  weightLabel?: string | null;
  style: string;
  prompt: string;
  durationSeconds: number;
  model: 'fast' | 'pro';
  /** Auth.users.id of the admin who triggered this generation via the
   *  /generate?as_user=<id> impersonation flow. Null for the normal
   *  shopper flow where the row's user_id IS the human triggering it.
   *  Surfaced on the admin user detail page so the queue view can
   *  split admin-triggered from self-triggered rows. */
  triggeredByAdminId?: string | null;
}

/**
 * Persist a single Generate submission. Writes the parent row + both pivot
 * tables in sequence - wrapped in try/rollback so the edge function never
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
      weight_label: input.weightLabel ?? null,
      style: input.style,
      prompt: input.prompt,
      duration_seconds: input.durationSeconds,
      model: input.model,
      triggered_by_admin_id: input.triggeredByAdminId ?? null,
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
  // doesn't have to wait for a cron to pick the pending row up. The
  // function is idempotent - if the pg_net trigger already fired it
  // returns { success: true, already: <status> } rather than an error.
  supabase.functions.invoke('generate-look', {
    body: { generation_id: gen.id },
  }).then(({ error }) => {
    if (error) console.warn('[createGeneration] invoke error:', error);
  }).catch(err => console.warn('[createGeneration] invoke exception:', err));

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
 * Build the Seedance reference-to-video prompt. Kept deliberately short  - 
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
  /** Frozen weight phrase ("160 lb", "73 kg"). When set the model gets
   *  a body-mass cue that materially improves silhouette accuracy
   *  (Seedance otherwise defaults to a generic build regardless of
   *  height). Omitted when the profile hasn't captured one yet — the
   *  prompt just skips the clause instead of fabricating a number. */
  weightLabel?: string | null;
  ageLabel?: string;
  style: string;
  // Free-text occasion ("West Village Date Night", "work", etc.) —
  // when present, mentioned in the prompt body so the model knows
  // what the look is FOR. Set by the Style → Shop this look → Try it
  // on flow which forwards the originating Style sheet's occasion via
  // ?occasion= URL param.
  occasion?: string;
  /** The user's free-text "your style" descriptor, set on the Style page
   *  and persisted on profiles.custom_style_prompt. Carried into the
   *  Seedance prompt so generated looks reflect the user's personal
   *  aesthetic regardless of which preset they pick. Empty when unset. */
  customStyle?: string | null;
  productLines: { role_tag: string | null; brand: string | null; name: string | null }[];
  durationSeconds?: number;
  /** Shopper gender — drives the neutral-coverage wording for any body
   *  area the picked products don't cover (e.g. a plain bra vs. a bare
   *  torso) so the model wears ONLY the products + tasteful basics. */
  gender?: 'male' | 'female' | 'unknown' | null;
}): string {
  const stylePreset = STYLE_PRESETS.find(s => s.value === opts.style);
  // Strip brand + product names from the prompt - Bytedance/Seedance's
  // partner_validation_failed filter rejects prompts that name specific
  // commercial brands or trademarked product titles. Only the role tag
  // (hat, jacket, sneakers, etc.) is kept so the model knows which slot
  // each reference image fills, without tripping content moderation.
  const productList = opts.productLines
    .map(p => p.role_tag?.toLowerCase() || 'item')
    .filter(Boolean)
    .join(', ');

  const ageClause = opts.ageLabel ? ` They look ${opts.ageLabel}.` : '';
  // Weight is appended INSIDE the height clause so Seedance reads the
  // build as one unit ("5'10" tall, ~160 lb"). Falsy/blank weight drops
  // the clause entirely so the model isn't fed a phantom number.
  const buildClause = opts.weightLabel
    ? `${opts.heightLabel} tall, around ${opts.weightLabel}`
    : `${opts.heightLabel} tall`;
  // Picked-zone framing: only show body regions where the shopper
  // actually picked an item. Stops Seedance from inventing pants /
  // shoes / accessories that were never selected.
  const framing = computeFraming(opts.productLines);
  // Product-only wardrobe: the model wears ONLY the attached products.
  // Any body area a product doesn't cover stays in plain neutral basics
  // (bare feet, a plain unbranded bra/tank, etc.) so nothing competes
  // with the featured products. Maximises product visibility.
  const wardrobe = computeProductOnlyWardrobe(opts.productLines, opts.gender);
  const seconds = opts.durationSeconds ?? 5;
  // Occasion is appended at the END of each prompt variant below so
  // it modifies the scene context without disrupting the existing
  // style-preset prompt structures (commercial, street, etc.) Empty
  // when not forwarded from the Style flow.
  const occasionClause = opts.occasion ? ` Scene: ${opts.occasion}.` : '';
  // Personal style direction from the Style page, woven in alongside the
  // occasion so the user's saved aesthetic shapes the render on every
  // preset. Trimmed/blank drops the clause.
  const customStyleClause = opts.customStyle && opts.customStyle.trim()
    ? ` Style direction: ${opts.customStyle.trim()}.`
    : '';

  if (opts.style === 'commercial') {
    const tones = detectBrandTones(opts.productLines);
    let castLine: string;
    let cameraLine: string;
    // Brand-tone presets give Seedance the visual language (palette,
    // pacing, camera moves), but Bytedance's partner_validation_failed
    // filter rejects prompts that name commercial brands verbatim. So
    // we keep the tone+camera *descriptors* and drop every brand-name
    // label. The visual cues do the actual work in the model - the
    // brand key was only a human-readable navigator in the template.
    if (tones.length === 0) {
      castLine = 'Cast them as the lead in a polished branded commercial - hero pacing, clean grade, on-brand palette.';
      cameraLine = 'Cinematography: bold dolly-in, low-angle hero framing, single rack focus to a product detail, motion-blur transition that reads as a cut.';
    } else if (tones.length === 1) {
      castLine = `Cast them as the lead in a polished commercial spot - ${tones[0].tone}.`;
      cameraLine = `Cinematography: ${tones[0].camera}.`;
    } else {
      const blendedTone = tones.map(t => t.tone).join('; meshing ');
      const blendedCamera = tones.map(t => t.camera).join(' / ');
      castLine = `Cast them as the lead in a polished crossover commercial - meshing ${blendedTone}. Frame it as a cohesive house-style spot.`;
      cameraLine = `Cinematography blends multiple house languages - ${blendedCamera}.`;
    }
    // Three-beat structure inside the single Seedance clip so it
    // reads as a commercial, not a static fit-cam. Seedance can't do
    // real edit cuts in one render, but aggressive composition shifts
    // + motion-blur transitions fake the look of cuts well.
    const beatLine = seconds >= 10
      ? 'Structure across the clip in 4 beats: (1) hero entrance - wide composed frame, subject walks/turns into shot; (2) push-in close-up at ~25% - face / detail moment; (3) action beat at ~55% - wardrobe interaction (zip pull, hand-in-pocket, head turn) with a motion-blur transition that reads as a cut; (4) hero stance + product reveal in the final third with a clean rack focus.'
      : 'Structure across the clip in 3 beats: (1) hero entrance in the first ~30%; (2) action / wardrobe interaction with a motion-blur transition that reads as a cut around the midpoint; (3) close-up product or expression hero in the final third.';
    return [
      `Use this person's face. Make them ${buildClause}.${ageClause}`,
      productList ? `Hero products on body: ${productList}.` : 'Hero the provided products on body.',
      wardrobe,
      castLine,
      cameraLine,
      beatLine,
      framing,
      `Lighting: strong key + rim, contrasty, motivated. Aggressive composition shifts that read as edit cuts. ${seconds}-second portrait clip, hero pacing, polished commercial grade.${occasionClause}${customStyleClause}`,
    ].join(' ');
  }

  const styleTag = stylePreset ? `, ${stylePreset.label.toLowerCase()} vibe` : '';

  return [
    // buildClause (height + weight) so the body build — including weight —
    // reaches Seedance on the default/lifestyle styles too, not just
    // commercial. Previously this branch hard-coded height only and the
    // weight clause was silently dropped.
    `Use this person's face. Make them ${buildClause}.${ageClause}`,
    productList ? `Put these products on them: ${productList}.` : 'Put the provided products on them.',
    wardrobe,
    framing,
    `Natural motion, ${seconds}-second portrait clip${styleTag}.${occasionClause}${customStyleClause}`,
  ].join(' ');
}
