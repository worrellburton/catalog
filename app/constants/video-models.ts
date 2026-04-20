// Shared video model catalog for admin generation flows.
// `value` is the string written to product_ads.veo_model; the Python
// worker in agents/video-generator/ad_generator.py honours it as a
// per-ad override and dispatches on the slug prefix:
//   - "veo-*-generate-preview"  → Google Gen AI (direct)
//   - "seedance-*" / "bytedance/seedance-*"  → Seedance via fal.ai
//   - "fal-ai/*"  → generic fal.ai pipeline

export type VideoModelGroup =
  | 'Veo (Google)'
  | 'Seedance (fal.ai)'
  | 'Kling (fal.ai)'
  | 'Sora (fal.ai)'
  | 'PixVerse (fal.ai)'
  | 'MiniMax (fal.ai)'
  | 'Wan (fal.ai)'
  | 'LTX (fal.ai)'
  | 'Vidu (fal.ai)'
  | 'Veo via fal.ai';

export interface VideoModel {
  value: string;
  label: string;
  group: VideoModelGroup;
}

export const VIDEO_MODELS: VideoModel[] = [
  // Veo via Google (direct — uses GOOGLE_API_KEY)
  { value: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast', group: 'Veo (Google)' },
  { value: 'veo-3.1-generate-preview', label: 'Veo 3.1', group: 'Veo (Google)' },
  { value: 'veo-3.1-lite-generate-preview', label: 'Veo 3.1 Lite', group: 'Veo (Google)' },

  // Seedance via fal.ai (silent)
  { value: 'seedance-2', label: 'Seedance 2', group: 'Seedance (fal.ai)' },
  { value: 'bytedance/seedance-2.0/fast/image-to-video', label: 'Seedance 2 Fast', group: 'Seedance (fal.ai)' },
  { value: 'seedance-1-pro', label: 'Seedance 1 Pro', group: 'Seedance (fal.ai)' },
  { value: 'seedance-1-lite', label: 'Seedance 1 Lite', group: 'Seedance (fal.ai)' },

  // Kling via fal.ai
  { value: 'fal-ai/kling-video/v3/pro/image-to-video', label: 'Kling v3 Pro', group: 'Kling (fal.ai)' },
  { value: 'fal-ai/kling-video/v2.6/pro/image-to-video', label: 'Kling v2.6 Pro', group: 'Kling (fal.ai)' },
  { value: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', label: 'Kling v2.5 Turbo Pro', group: 'Kling (fal.ai)' },

  // Sora via fal.ai
  { value: 'fal-ai/sora-2/image-to-video/pro', label: 'Sora 2 Pro', group: 'Sora (fal.ai)' },
  { value: 'fal-ai/sora-2/image-to-video', label: 'Sora 2', group: 'Sora (fal.ai)' },

  // PixVerse via fal.ai
  { value: 'fal-ai/pixverse/v6/image-to-video', label: 'PixVerse v6', group: 'PixVerse (fal.ai)' },
  { value: 'fal-ai/pixverse/c1/image-to-video', label: 'PixVerse c1', group: 'PixVerse (fal.ai)' },

  // MiniMax Hailuo via fal.ai
  { value: 'fal-ai/minimax/hailuo-02/standard/image-to-video', label: 'MiniMax Hailuo 02', group: 'MiniMax (fal.ai)' },

  // Wan via fal.ai
  { value: 'fal-ai/wan/v2.2-a14b/image-to-video', label: 'Wan v2.2-A14B', group: 'Wan (fal.ai)' },

  // LTX via fal.ai
  { value: 'fal-ai/ltx-2-19b/image-to-video', label: 'LTX-2 19B', group: 'LTX (fal.ai)' },

  // Vidu via fal.ai — reference-to-video accepts up to 7 images for
  // multi-angle product consistency.
  { value: 'fal-ai/vidu/reference-to-video', label: 'Vidu Ref (multi-image)', group: 'Vidu (fal.ai)' },
  { value: 'fal-ai/vidu/image-to-video', label: 'Vidu', group: 'Vidu (fal.ai)' },
  { value: 'fal-ai/vidu/start-end-to-video', label: 'Vidu Start→End', group: 'Vidu (fal.ai)' },

  // Veo via fal.ai (alternative billing path — uses FAL_KEY, no Google quota)
  { value: 'fal-ai/veo3.1/fast/image-to-video', label: 'Veo 3.1 Fast (via fal)', group: 'Veo via fal.ai' },
  { value: 'fal-ai/veo3.1/image-to-video', label: 'Veo 3.1 (via fal)', group: 'Veo via fal.ai' },
];

export const DEFAULT_VIDEO_MODEL = 'veo-3.1-fast-generate-preview';
