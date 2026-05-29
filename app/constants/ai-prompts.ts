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

// nano-banana/edit reframe-to-5:4 packshot prompt (polish-primary-image).
export const DEFAULT_POLISH_PRIMARY_PROMPT = [
  'Reframe this product image into a standardized e-commerce shot with a 5:4 aspect ratio (landscape, e.g. 2000x1600px).',
  "Keep the product's existing background exactly as-is — do not remove, replace, or alter it.",
  'Center the product both horizontally and vertically so it occupies approximately 60% of the frame, with equal padding (~15% of the canvas) on all four sides, extending the existing background naturally to fill any added space.',
  "Preserve the product's original colors, texture, lighting, proportions, and details exactly — do not alter, recolor, or restyle the product itself.",
  'Output a crisp image suitable for a uniform product catalog grid.',
].join(' ');

// Seedance 2.0 image-to-video subtle-motion prompt (generate-primary-video).
export const DEFAULT_PRIMARY_VIDEO_PROMPT = [
  'Use this exact image as the first frame.',
  'Static shot, show subtle cinematic motion of the product.',
  'If a person is in frame, keep their mouth fully closed — they must not speak, mouth words, or move their lips.',
  'Make it 4:5.',
].join(' ');

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
];
