// Per-video cost estimates for each video model. Used by the Finance page
// and the worker's cost estimator when an ad finishes but the provider
// didn't return a billed amount.
//
// Numbers are ballpark for a single ~5s 720p portrait clip at list price.
// Actual spend per ad is stored on product_ads.cost_usd when the provider
// returns it; this table is the fallback + rate sheet.

export interface ModelPricing {
  value: string;
  label: string;
  group: string;
  costUsd: number;     // per 5s video at default resolution
  provider: 'google' | 'fal';
  multiImage?: boolean; // accepts multiple reference images
  notes?: string;
}

export const VIDEO_MODEL_PRICING: ModelPricing[] = [
  // Veo via Google (direct — GOOGLE_API_KEY)
  { value: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast', group: 'Veo (Google)', provider: 'google', costUsd: 0.10 },
  { value: 'veo-3.1-generate-preview', label: 'Veo 3.1', group: 'Veo (Google)', provider: 'google', costUsd: 0.40 },
  { value: 'veo-3.1-lite-generate-preview', label: 'Veo 3.1 Lite', group: 'Veo (Google)', provider: 'google', costUsd: 0.05 },

  // Seedance via fal.ai
  { value: 'seedance-2', label: 'Seedance 2', group: 'Seedance (fal.ai)', provider: 'fal', costUsd: 0.30 },
  { value: 'bytedance/seedance-2.0/fast/image-to-video', label: 'Seedance 2 Fast', group: 'Seedance (fal.ai)', provider: 'fal', costUsd: 0.15 },
  { value: 'seedance-1-pro', label: 'Seedance 1 Pro', group: 'Seedance (fal.ai)', provider: 'fal', costUsd: 0.25 },
  { value: 'seedance-1-lite', label: 'Seedance 1 Lite', group: 'Seedance (fal.ai)', provider: 'fal', costUsd: 0.10 },

  // Kling
  { value: 'fal-ai/kling-video/v3/pro/image-to-video', label: 'Kling v3 Pro', group: 'Kling (fal.ai)', provider: 'fal', costUsd: 0.35 },
  { value: 'fal-ai/kling-video/v2.6/pro/image-to-video', label: 'Kling v2.6 Pro', group: 'Kling (fal.ai)', provider: 'fal', costUsd: 0.30 },
  { value: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', label: 'Kling v2.5 Turbo Pro', group: 'Kling (fal.ai)', provider: 'fal', costUsd: 0.25 },

  // Sora
  { value: 'fal-ai/sora-2/image-to-video/pro', label: 'Sora 2 Pro', group: 'Sora (fal.ai)', provider: 'fal', costUsd: 0.40 },
  { value: 'fal-ai/sora-2/image-to-video', label: 'Sora 2', group: 'Sora (fal.ai)', provider: 'fal', costUsd: 0.25 },

  // PixVerse
  { value: 'fal-ai/pixverse/v6/image-to-video', label: 'PixVerse v6', group: 'PixVerse (fal.ai)', provider: 'fal', costUsd: 0.20 },
  { value: 'fal-ai/pixverse/c1/image-to-video', label: 'PixVerse c1', group: 'PixVerse (fal.ai)', provider: 'fal', costUsd: 0.15 },

  // MiniMax
  { value: 'fal-ai/minimax/hailuo-02/standard/image-to-video', label: 'MiniMax Hailuo 02', group: 'MiniMax (fal.ai)', provider: 'fal', costUsd: 0.10 },

  // Wan
  { value: 'fal-ai/wan/v2.2-a14b/image-to-video', label: 'Wan v2.2-A14B', group: 'Wan (fal.ai)', provider: 'fal', costUsd: 0.25 },

  // LTX
  { value: 'fal-ai/ltx-2-19b/image-to-video', label: 'LTX-2 19B', group: 'LTX (fal.ai)', provider: 'fal', costUsd: 0.15 },

  // Vidu — multi-image reference model is the headline feature
  { value: 'fal-ai/vidu/reference-to-video', label: 'Vidu Ref (multi-image)', group: 'Vidu (fal.ai)', provider: 'fal', costUsd: 0.20, multiImage: true, notes: 'Accepts up to 3 reference images (fal.ai cap)' },
  { value: 'fal-ai/vidu/image-to-video', label: 'Vidu', group: 'Vidu (fal.ai)', provider: 'fal', costUsd: 0.15 },
  { value: 'fal-ai/vidu/start-end-to-video', label: 'Vidu Start→End', group: 'Vidu (fal.ai)', provider: 'fal', costUsd: 0.20 },

  // Veo via fal (alternate billing path)
  { value: 'fal-ai/veo3.1/fast/image-to-video', label: 'Veo 3.1 Fast (via fal)', group: 'Veo via fal.ai', provider: 'fal', costUsd: 0.12 },
  { value: 'fal-ai/veo3.1/image-to-video', label: 'Veo 3.1 (via fal)', group: 'Veo via fal.ai', provider: 'fal', costUsd: 0.45 },
];

export const PRICING_BY_SLUG: Record<string, ModelPricing> = Object.fromEntries(
  VIDEO_MODEL_PRICING.map(m => [m.value, m]),
);

export function estimateAdCost(modelSlug: string | null | undefined): number {
  if (!modelSlug) return 0.10; // default to fast Veo cost
  return PRICING_BY_SLUG[modelSlug]?.costUsd ?? 0.10;
}
