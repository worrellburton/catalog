// Editable AI prompts surfaced in the admin Data → Settings modal and
// consumed by the matching edge functions. Each prompt is stored in the
// `app_settings` key/value table under the keys below; when a row is
// absent the edge function falls back to the DEFAULT_* string here.
//
// IMPORTANT: the edge functions (supabase/functions/polish-primary-image,
// supabase/functions/generate-primary-video) keep their own inline copy
// of these defaults as a last-resort fallback — they can't import from
// `app/`. Keep the two in sync when editing a default.

export const PROMPT_POLISH_PRIMARY_KEY = 'prompt_polish_primary';
export const PROMPT_PRIMARY_VIDEO_KEY = 'prompt_primary_video';
export const PROMPT_HAIKU_CONTEXT_KEY = 'prompt_haiku_context';

// Gemini 2.5 Flash Image (nano-banana) reframe packshot prompt
// (polish-primary-image). "Add padding" framing is much stricter than
// "occupies 60%" — Gemini was reading the latter as "make the product
// bigger" and producing zoomed crops. Explicit DO NOT ZOOM language +
// concrete pixel padding numbers fix this.
export const DEFAULT_POLISH_PRIMARY_PROMPT = [
  'Take the supplied product image and convert it to a 3:4 portrait aspect ratio.',
  'DO NOT zoom in. DO NOT crop the product or change its size. The product must appear at the SAME SCALE as in the source image — never larger.',
  'Add neutral padding (extend the existing background) above, below, and on the sides as needed to reach a 3:4 canvas.',
  'The product should occupy about 60–70% of the canvas HEIGHT, with clear empty space (background) above and below it. Generous breathing room.',
  "Keep the product's existing background exactly as-is — do not remove, replace, or recolor it. Extend it naturally into the new padding area.",
  "Preserve the product's original colors, texture, lighting, proportions, and every detail exactly. Do not restyle the product.",
  'Output a crisp packshot with comfortable margin around the product.',
].join(' ');

// Seedance 2.0 image-to-video subtle-motion prompt (generate-primary-video).
// Camera-lock language is explicit — without it Seedance interprets "subtle
// cinematic motion" as a slow zoom-in, and the later frames of the loop
// crop into the subject's face / chest, breaking the catalog tile.
export const DEFAULT_PRIMARY_VIDEO_PROMPT = [
  'Use this exact image as the first frame, do not change the framing.',
  'Locked-off camera — no zoom, no pan, no tilt, no dolly, no rotation, no parallax.',
  'The camera stays perfectly still. Only the product itself moves: gentle fabric drape, soft breeze in the fabric, the subject breathes naturally.',
  'Keep the product the same size in every frame.',
  'If a person is in frame, keep their mouth fully closed — they must not speak, mouth words, or move their lips.',
  'Portrait 3:4 composition.',
].join(' ');

// Claude Haiku vision read of a product's primary image (haiku-context
// edge function). The function ALWAYS prepends a metadata block built from
// the row — title, brand, price, materials — then sends the primary image
// and appends THIS instruction. The picture is the main reference; the
// metadata is supporting context only. The two-line shape is a hard
// contract: type governance reads ONLY line 1 (haikuIdentity), so keep
// "Line 1 = bare category, Line 2 = colour-first detail" if you edit it.
export const DEFAULT_HAIKU_CONTEXT_PROMPT = [
  'Identify what this item ACTUALLY is. Use the PHOTO as your main reference — product titles and metadata often mislead, so trust the image first and treat the title, brand, price, and materials as supporting hints only.',
  '',
  'Reply in EXACTLY two lines, nothing else. Plain text only — no markdown, no "#" headings, no labels, no blank line, no bullets:',
  'Line 1 — the item\'s category in 1-4 plain words, using the most common everyday noun for it (e.g. "potted plant", "high heels", "denim jacket", "table lamp"). Name only the object itself. Do NOT mention the room, background, setting, or surroundings.',
  'Line 2 — one dense sentence that STARTS with the item\'s main colour(s), then its materials and any notable detail.',
  '',
  'No marketing language.',
].join('\n');

export interface PromptSetting {
  key: string;
  label: string;
  description: string;
  defaultValue: string;
}

// Drives the rows rendered in the Settings modal. Add a new entry here
// (plus a matching edge-function read) to expose another editable prompt.
export const EDITABLE_PROMPTS: PromptSetting[] = [
  {
    key: PROMPT_POLISH_PRIMARY_KEY,
    label: 'Polish Primary',
    description: 'Sent to nano-banana when polishing / re-polishing a primary image into a uniform packshot.',
    defaultValue: DEFAULT_POLISH_PRIMARY_PROMPT,
  },
  {
    key: PROMPT_PRIMARY_VIDEO_KEY,
    label: 'Primary Video',
    description: 'Sent to Seedance 2.0 when generating a primary video from the primary image.',
    defaultValue: DEFAULT_PRIMARY_VIDEO_PROMPT,
  },
  {
    key: PROMPT_HAIKU_CONTEXT_KEY,
    label: 'Haiku Context',
    description: 'Sent to Claude Haiku (with the primary image + the product title, brand, price and materials) to read what each product actually is. Feeds the type/gender governance. The metadata block is added automatically — this is the instruction that follows it.',
    defaultValue: DEFAULT_HAIKU_CONTEXT_PROMPT,
  },
];
