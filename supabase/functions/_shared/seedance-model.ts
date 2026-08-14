// Seedance model-slug helpers, shared by generate-look (render dispatch) and
// check-face-photo (preflight probe).
//
// Detection is PREFIX-based, never an exact slug set. Every Seedance version
// shares the same request body AND the same ByteDance face filter, so a newer
// version must keep the Seedance code paths — the face-grid bypass above all.
// An exact-set check silently drops a new version through to the generic fal
// submit: the render then trips partner_validation on every real selfie and
// fal-webhook quietly falls back to Gemini Omni, so the platform looks like
// it's on Seedance while never once rendering with it.

/** Canonical fal endpoints for the two Seedance 2.0 tiers. */
export const SEEDANCE_20_FAST = 'bytedance/seedance-2.0/fast/reference-to-video';
// Pro is the default tier on fal.ai — no `/pro/` path segment. The fast tier
// gets its own `/fast/` subpath; everything else routes through the bare one.
export const SEEDANCE_20_PRO = 'bytedance/seedance-2.0/reference-to-video';

/** Any Seedance slug — real fal endpoints and the legacy bare aliases. */
export function isSeedanceModel(slug: string): boolean {
  return slug.startsWith('bytedance/seedance') || slug.startsWith('seedance-');
}

/** A real fal Seedance endpoint (legacy aliases are not routable). */
export function isSeedanceEndpoint(slug: string): boolean {
  return slug.startsWith('bytedance/seedance');
}

// Only Seedance 2.0 and the legacy aliases expose fast/pro tiers, so only they
// honour the shopper's fast/pro choice. 2.5+ ships a single endpoint — its slug
// is used verbatim and the fast/pro toggle is a no-op.
const TIERED = new Set([SEEDANCE_20_FAST, SEEDANCE_20_PRO, 'seedance-2', 'seedance-1-pro', 'seedance-1-lite']);

/** Whether this slug should be rewritten to a fast/pro tier endpoint. */
export function hasSeedanceTiers(slug: string): boolean {
  return TIERED.has(slug);
}

/** Tier endpoint for the shopper's quality choice. */
export function seedanceSlugFor(model: string | null | undefined): string {
  return model === 'pro' ? SEEDANCE_20_PRO : SEEDANCE_20_FAST;
}

/**
 * Fal's queue status/cancel/result routes are keyed by the APP base (the first
 * two path segments), not the full endpoint id:
 *   bytedance/seedance-2.5/reference-to-video → bytedance/seedance-2.5
 */
export function falAppBase(slug: string): string {
  return slug.split('/').slice(0, 2).join('/');
}
