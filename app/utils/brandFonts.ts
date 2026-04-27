// Brand font catalog — the typefaces an admin can pick from on the
// /admin/branding page. The chosen variant id is persisted in localStorage
// (see useBrandLogo) and read by CatalogLogo so the wordmark renders the
// admin's pick everywhere it appears (header, password gate, landing).
//
// 'original' is special: it renders the existing SVG wordmark instead of a
// font-rendered span. All others are Google-Fonts-hosted faces.

export interface BrandVariant {
  id: string;
  label: string;
  /** CSS font-family value. Empty for 'original'. */
  fontFamily: string;
  /** Full Google Fonts CSS URL — null for the original SVG. */
  googleFontUrl?: string;
  /** Visual tweaks per face so each variant reads at its best at logo scale. */
  weight?: number;
  italic?: boolean;
  letterSpacing?: string;
  textTransform?: 'none' | 'lowercase' | 'uppercase';
}

const G = (family: string, params: string) =>
  `https://fonts.googleapis.com/css2?family=${family}${params ? '&' + params : ''}&display=swap`;

export const BRAND_VARIANTS: BrandVariant[] = [
  // The first slot is always the canonical SVG mark — gives admins a clean
  // "revert to default" choice with the same identity they were on before.
  { id: 'original', label: 'Original', fontFamily: '' },

  // Geometric sans
  { id: 'inter',          label: 'Inter',           fontFamily: '"Inter", sans-serif',                   googleFontUrl: G('Inter:wght@500;700', ''),                weight: 700, letterSpacing: '-0.04em' },
  { id: 'manrope',        label: 'Manrope',         fontFamily: '"Manrope", sans-serif',                 googleFontUrl: G('Manrope:wght@500;800', ''),              weight: 800, letterSpacing: '-0.04em' },
  { id: 'jakarta',        label: 'Plus Jakarta',    fontFamily: '"Plus Jakarta Sans", sans-serif',       googleFontUrl: G('Plus+Jakarta+Sans:wght@500;700', ''),    weight: 700, letterSpacing: '-0.03em' },
  { id: 'space-grotesk',  label: 'Space Grotesk',   fontFamily: '"Space Grotesk", sans-serif',           googleFontUrl: G('Space+Grotesk:wght@500;700', ''),        weight: 700, letterSpacing: '-0.025em' },
  { id: 'sora',           label: 'Sora',            fontFamily: '"Sora", sans-serif',                    googleFontUrl: G('Sora:wght@500;800', ''),                 weight: 800, letterSpacing: '-0.04em' },
  { id: 'outfit',         label: 'Outfit',          fontFamily: '"Outfit", sans-serif',                  googleFontUrl: G('Outfit:wght@500;700', ''),               weight: 700, letterSpacing: '-0.03em' },

  // Bold display
  { id: 'archivo-black',  label: 'Archivo Black',   fontFamily: '"Archivo Black", sans-serif',           googleFontUrl: G('Archivo+Black', ''),                     weight: 400, letterSpacing: '-0.02em' },
  { id: 'big-shoulders',  label: 'Big Shoulders',   fontFamily: '"Big Shoulders Display", sans-serif',   googleFontUrl: G('Big+Shoulders+Display:wght@800', ''),    weight: 800, letterSpacing: '0.01em', textTransform: 'uppercase' },
  { id: 'unbounded',      label: 'Unbounded',       fontFamily: '"Unbounded", sans-serif',               googleFontUrl: G('Unbounded:wght@500;800', ''),            weight: 800, letterSpacing: '-0.02em' },

  // Serif / classic
  { id: 'playfair',       label: 'Playfair',        fontFamily: '"Playfair Display", serif',             googleFontUrl: G('Playfair+Display:ital,wght@0,500;0,800;1,500', ''), weight: 800, letterSpacing: '-0.02em' },
  { id: 'bodoni',         label: 'Bodoni Moda',     fontFamily: '"Bodoni Moda", serif',                  googleFontUrl: G('Bodoni+Moda:ital,wght@0,500;0,800;1,500', ''),      weight: 800, letterSpacing: '-0.01em' },
  { id: 'cormorant',      label: 'Cormorant',       fontFamily: '"Cormorant Garamond", serif',           googleFontUrl: G('Cormorant+Garamond:wght@500;700', ''),               weight: 700, letterSpacing: '0' },
  { id: 'cinzel',         label: 'Cinzel',          fontFamily: '"Cinzel", serif',                       googleFontUrl: G('Cinzel:wght@600;800', ''),                            weight: 800, letterSpacing: '0.04em', textTransform: 'uppercase' },
  { id: 'dm-serif',       label: 'DM Serif',        fontFamily: '"DM Serif Display", serif',             googleFontUrl: G('DM+Serif+Display:ital@0;1', ''),                      weight: 400, letterSpacing: '-0.01em' },

  // Mono / technical
  { id: 'plex-mono',      label: 'IBM Plex Mono',   fontFamily: '"IBM Plex Mono", monospace',            googleFontUrl: G('IBM+Plex+Mono:wght@400;600', ''),         weight: 600, letterSpacing: '-0.04em' },
  { id: 'jetbrains-mono', label: 'JetBrains Mono',  fontFamily: '"JetBrains Mono", monospace',           googleFontUrl: G('JetBrains+Mono:wght@500;700', ''),        weight: 700, letterSpacing: '-0.04em' },

  // Editorial / soft
  { id: 'fraunces',       label: 'Fraunces',        fontFamily: '"Fraunces", serif',                     googleFontUrl: G('Fraunces:ital,opsz,wght@0,144,500;1,144,800', ''), weight: 800, letterSpacing: '-0.03em' },
  { id: 'instrument',     label: 'Instrument',      fontFamily: '"Instrument Serif", serif',             googleFontUrl: G('Instrument+Serif:ital@0;1', ''),                    weight: 400, italic: true, letterSpacing: '-0.02em' },

  // Hand / personality
  { id: 'caveat',         label: 'Caveat',          fontFamily: '"Caveat", cursive',                     googleFontUrl: G('Caveat:wght@500;700', ''),                weight: 700, letterSpacing: '-0.01em' },
  { id: 'monoton',        label: 'Monoton',         fontFamily: '"Monoton", display',                    googleFontUrl: G('Monoton', ''),                            weight: 400, letterSpacing: '0.04em', textTransform: 'uppercase' },
  { id: 'tilt-warp',      label: 'Tilt Warp',       fontFamily: '"Tilt Warp", sans-serif',               googleFontUrl: G('Tilt+Warp', ''),                          weight: 400, letterSpacing: '-0.02em' },
  { id: 'rubik',          label: 'Rubik',           fontFamily: '"Rubik", sans-serif',                   googleFontUrl: G('Rubik:wght@500;800', ''),                 weight: 800, letterSpacing: '-0.03em' },
];

const injected = new Set<string>();

/** Inject a Google Fonts <link> if it isn't already present. Idempotent. */
export function ensureBrandFont(url: string | undefined): void {
  if (!url || typeof document === 'undefined') return;
  if (injected.has(url)) return;
  injected.add(url);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);
}

export const DEFAULT_VARIANT_ID = 'original';

export function getVariant(id: string | null | undefined): BrandVariant {
  if (!id) return BRAND_VARIANTS[0];
  return BRAND_VARIANTS.find(v => v.id === id) ?? BRAND_VARIANTS[0];
}
