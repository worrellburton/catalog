// AI Stylist — asks the `ai-stylist` edge function to assemble a single outfit
// from a candidate product set for a free-text occasion. The reasoning lives
// server-side (Claude); the client just sends the occasion + the candidates it
// already loaded for the picker, and maps the returned ids back to products.

import { supabase } from '~/utils/supabase';

export type StylistSlot = 'tops' | 'dresses' | 'bottoms' | 'shoes';

/** The minimal product shape the stylist reasons over. */
export interface StylistCandidate {
  id: string;
  name: string;
  brand?: string | null;
  price?: string | null;
  role?: string | null;
  context?: string | null;
}

/** One chosen product id per slot (null = nothing picked for that slot). */
export interface StylistOutfit {
  tops: string | null;
  dresses: string | null;
  bottoms: string | null;
  shoes: string | null;
}

export interface StylistResult {
  outfit: StylistOutfit;
  rationale: string;
  /** 'claude' when the reasoning model ran, 'heuristic' when it fell back. */
  source: 'claude' | 'heuristic';
}

const EMPTY_OUTFIT: StylistOutfit = { tops: null, dresses: null, bottoms: null, shoes: null };

/** The slots shown in the stylist result, top → bottom (per spec). */
export const STYLIST_SLOTS: { key: StylistSlot; label: string }[] = [
  { key: 'tops', label: 'Tops' },
  { key: 'dresses', label: 'Dresses' },
  { key: 'bottoms', label: 'Bottoms' },
  { key: 'shoes', label: 'Shoes' },
];

export async function suggestOutfit(
  occasion: string,
  gender: string,
  candidates: StylistCandidate[],
): Promise<StylistResult> {
  if (!supabase || !occasion.trim() || candidates.length === 0) {
    return { outfit: EMPTY_OUTFIT, rationale: '', source: 'heuristic' };
  }
  const { data, error } = await supabase.functions.invoke('ai-stylist', {
    body: { occasion: occasion.trim(), gender, candidates },
  });
  if (error || !data?.success) {
    throw new Error(error?.message || data?.error || 'Stylist failed');
  }
  return {
    outfit: { ...EMPTY_OUTFIT, ...(data.outfit as StylistOutfit) },
    rationale: typeof data.rationale === 'string' ? data.rationale : '',
    source: data.source === 'claude' ? 'claude' : 'heuristic',
  };
}
