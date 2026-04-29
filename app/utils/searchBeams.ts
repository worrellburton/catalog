// Search-bar beam variants — picked by the admin in /admin/ui/search-bar
// and applied site-wide as a class on the bottom-bar pill. Each variant
// owns its own pseudo-element animation (see app/styles/bottom-bar.css).

export type SearchBeamId =
  | 'none'
  | 'apple'
  | 'mirrored'
  | 'aurora'
  | 'comet'
  | 'pulse';

export interface SearchBeamVariant {
  id: SearchBeamId;
  label: string;
  blurb: string;
}

export const SEARCH_BEAMS: SearchBeamVariant[] = [
  { id: 'none',     label: 'Off',                blurb: 'No animated border. Default static pill.' },
  { id: 'apple',    label: 'Single beam',        blurb: 'White hot spot orbits ~6 s. Apple Intelligence vibe.' },
  { id: 'mirrored', label: 'Mirrored beams',     blurb: 'Two opposing beams spin together. Sci-fi.' },
  { id: 'aurora',   label: 'Aurora',             blurb: 'Continuous iridescent wash, ~12 s rotation.' },
  { id: 'comet',    label: 'Comet',              blurb: 'Single beam with a fading tail behind it.' },
  { id: 'pulse',    label: 'Glow + beam',        blurb: 'Outer halo pulse plus a rotating beam.' },
];

export const DEFAULT_SEARCH_BEAM: SearchBeamId = 'none';

export function getSearchBeam(id: string | null | undefined): SearchBeamVariant {
  if (!id) return SEARCH_BEAMS[0];
  return SEARCH_BEAMS.find(b => b.id === id) ?? SEARCH_BEAMS[0];
}
