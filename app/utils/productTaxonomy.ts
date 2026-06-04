// Product taxonomy helpers
//
// Two jobs:
//   1. Decide whether a product's *fit* is worth surfacing. Garment fit
//      (relaxed / slim / "runs small") only makes sense for things you
//      wear — a book or a candle has no fit, so the Fit row and the
//      body-type ("Suits") chips are hidden for them.
//   2. Turn the enrichment metadata we already collect
//      (styling_metadata, fit_intelligence) into shopper-facing chip
//      groups like "Great for date night" / "Suits petite".
//
// All functions are pure so they're trivially testable and carry no
// React/Supabase dependencies.

import type { FitIntelligence, StylingMetadata } from '~/services/product-details';

// Categories (product_taxonomy.category) where garment fit is meaningful.
// Accessories / jewelry / bags / eyewear are intentionally excluded — they
// are "fashion" but have no garment fit, so they fall through to the
// fit_type === 'not_applicable' guard below.
const FASHION_FIT_CATEGORIES = new Set<string>([
  'tops',
  'bottoms',
  'dresses',
  'outerwear',
  'knitwear',
  'activewear',
  'underwear',
  'sleepwear',
  'swimwear',
  'footwear',
  'headwear',
  'fashion',
]);

const NOT_APPLICABLE = 'not_applicable';

/**
 * True when this product has a garment fit worth showing. The enrichment
 * pipeline already stamps non-apparel with fit_type === 'not_applicable',
 * so that's the most reliable signal; we fall back to the category set
 * for rows that have a taxonomy but no fit_intelligence yet.
 */
export function isFitRelevant(
  category?: string | null,
  fitIntel?: FitIntelligence | null,
): boolean {
  const fitType = fitIntel?.fit_type?.trim().toLowerCase();
  if (fitType) return fitType !== NOT_APPLICABLE;
  if (category) return FASHION_FIT_CATEGORIES.has(category.trim().toLowerCase());
  return false;
}

/** "date night" → "Date night"; leaves already-capitalized words alone. */
function sentenceCase(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Drop blanks, the not_applicable sentinel, and case-insensitive dupes. */
function cleanList(values: string[] | null | undefined, cap: number): string[] {
  if (!values || values.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = (v || '').trim();
    if (!t) continue;
    const lower = t.toLowerCase();
    if (lower === NOT_APPLICABLE) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(sentenceCase(t));
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Short fit descriptor derived from fit_intelligence, used to fill the
 * Fit row when the scraper didn't capture a free-text size_fit sentence.
 * e.g. fit_type "relaxed" + true_to_size "runs small"
 *      → "Relaxed fit · runs small". Returns null when there's nothing
 * meaningful (non-apparel / empty).
 */
export function deriveFitLabel(fitIntel?: FitIntelligence | null): string | null {
  if (!fitIntel) return null;
  const parts: string[] = [];

  const fitType = fitIntel.fit_type?.trim().toLowerCase().replace(/_/g, ' ');
  if (fitType && fitType !== 'not applicable') {
    parts.push(`${sentenceCase(fitType)} fit`);
  }

  // true_to_size is an enum: "true_to_size" | "runs_small" | "runs_large" |
  // "size_up" | "size_down" (and the not_applicable sentinel). Normalize the
  // underscores and phrase each as a short clause.
  const tts = fitIntel.true_to_size?.trim().toLowerCase().replace(/_/g, ' ');
  if (tts && tts !== 'not applicable') {
    if (tts.includes('true')) parts.push('True to size');
    else if (tts.startsWith('runs') || tts.startsWith('size')) parts.push(sentenceCase(tts));
    else parts.push(sentenceCase(`runs ${tts}`));
  }

  if (parts.length === 0) return null;
  return parts.join(' · ');
}

export type ChipTone = 'occasion' | 'fit' | 'season' | 'pairs';

export interface ChipGroup {
  key: string;
  label: string;
  tone: ChipTone;
  items: string[];
}

interface ChipInputs {
  fitIntel?: FitIntelligence | null;
  styling?: StylingMetadata | null;
  /** Whether fit/body chips should be included (apparel only). */
  fitRelevant: boolean;
}

/**
 * Build the ordered chip groups rendered below the spec sheet. Occasion /
 * season / "style it with" are universal (a book gets "Book club", a chair
 * gets its use-cases); the body-type "Suits" group is apparel-only and acts
 * as the stand-in for the age/demographic angle until age is collected.
 */
export function buildSuggestionChipGroups({ fitIntel, styling, fitRelevant }: ChipInputs): ChipGroup[] {
  const groups: ChipGroup[] = [];

  const occasion = cleanList(styling?.occasion, 5);
  if (occasion.length) {
    groups.push({ key: 'occasion', label: 'Great for', tone: 'occasion', items: occasion });
  }

  if (fitRelevant) {
    const suits = cleanList(fitIntel?.body_type_match, 4);
    if (suits.length) {
      groups.push({ key: 'suits', label: 'Suits', tone: 'fit', items: suits });
    }
  }

  const season = cleanList(styling?.season, 4);
  if (season.length) {
    groups.push({ key: 'season', label: 'Season', tone: 'season', items: season });
  }

  const pairs = cleanList(styling?.works_with, 4);
  if (pairs.length) {
    groups.push({ key: 'pairs', label: 'Style it with', tone: 'pairs', items: pairs });
  }

  return groups;
}
