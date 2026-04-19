// Shared video model catalog for admin generation flows.
// `value` is the string written to product_ads.veo_model; the Python
// worker in agents/video-generator/ac_generator.py honours it as a
// per-ad override.

export type VideoModelGroup = 'Veo (Google)' | 'Seedance (fal.ai)';

export interface VideoModel {
  value: string;
  label: string;
  group: VideoModelGroup;
}

export const VIDEO_MODELS: VideoModel[] = [
  { value: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast', group: 'Veo (Google)' },
  { value: 'veo-3.1-generate-preview', label: 'Veo 3.1', group: 'Veo (Google)' },
  { value: 'veo-3.1-lite-generate-preview', label: 'Veo 3.1 Lite', group: 'Veo (Google)' },
  { value: 'seedance-1-pro', label: 'Seedance 1 Pro', group: 'Seedance (fal.ai)' },
  { value: 'seedance-1-lite', label: 'Seedance 1 Lite', group: 'Seedance (fal.ai)' },
];

export const DEFAULT_VIDEO_MODEL = 'veo-3.1-fast-generate-preview';
