// Trail id helpers — single source of truth for the strings shared between
// source surfaces (LookCard, CreativeCard, brand strip tiles) and
// destination surfaces (LookOverlay hero, ProductPage hero) so that
// Framer Motion's layoutId + TrailVideoHost both resolve to the same
// element on both sides of a navigation.

export const lookTrailId    = (id: number | string) => `look-${id}`;
export const productTrailId = (id: string)          => `pc-${id}`;

// Look video URLs flow from two places:
//   1. The legacy hard-coded list (app/data/looks.ts) — bare filenames
//      like "girl1.mp4" that live under /public/.
//   2. services/looks.ts after migration 048 — full Supabase storage URLs.
// Prefixing the GitHub-Pages basePath blindly breaks case 2. This helper
// normalizes both shapes to a usable absolute URL.
export function normalizeLookVideoUrl(raw: string | null | undefined, basePath: string): string {
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/'))       return raw;
  return `${basePath}/${raw}`;
}
