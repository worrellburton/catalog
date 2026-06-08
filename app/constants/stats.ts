/**
 * Shared height + age option sets used by /generate, /style, and any
 * future stats editor surface. Single source of truth so the labels
 * stay consistent across surfaces and downstream pipelines (Seedance
 * prompts, profile rows, etc.) hear the same string everywhere.
 */

export interface HeightOption {
  cm: number;
  label: string;
}

// 4'10" – 6'8" in 1" increments. cm is the storage value; label is the
// human string the model hears verbatim.
export const HEIGHT_OPTIONS: HeightOption[] = (() => {
  const out: HeightOption[] = [];
  for (let totalInches = 58; totalInches <= 80; totalInches++) {
    const ft = Math.floor(totalInches / 12);
    const inches = totalInches % 12;
    out.push({ cm: Math.round(totalInches * 2.54), label: `${ft}'${inches}"` });
  }
  return out;
})();

export interface WeightOption {
  /** Storage value, kilograms with one decimal. */
  kg: number;
  /** Human label the Seedance/Veo prompt hears verbatim. Imperial-first
   *  to match how shoppers self-report in the US; the kg figure is
   *  appended for the model so it has unambiguous build data. */
  label: string;
}

// 90–280 lb in 5-lb steps. Covers the shopper range without exploding
// the dropdown; the prompt reads the label verbatim so we keep the
// "lb (kg)" hybrid so models with non-US training data still get a
// metric anchor. Same scheme as HEIGHT_OPTIONS: kg is the storage
// value, label is what the model sees.
export const WEIGHT_OPTIONS: WeightOption[] = (() => {
  const out: WeightOption[] = [];
  for (let lb = 90; lb <= 280; lb += 5) {
    const kg = Math.round(lb * 0.45359237 * 10) / 10;
    out.push({ kg, label: `${lb} lb (${kg} kg)` });
  }
  return out;
})();

export const AGE_OPTIONS: readonly string[] = [
  'teens',
  'early 20s',
  'mid 20s',
  'late 20s',
  'early 30s',
  'mid 30s',
  'late 30s',
  'early 40s',
  'mid 40s',
  'late 40s',
  'early 50s',
  'mid 50s',
  'late 50s',
  '60s',
  '70s',
];

export type GenderOption = 'male' | 'female' | 'unknown';

/**
 * Advanced ("expert") body-proportion + aesthetic inputs. Optional — they
 * sit behind the Advanced-mode toggle in the stats editor and refine the
 * generated model's silhouette and styling. Stored as the label verbatim so
 * the Seedance prompt can read them directly. An empty string means "unset".
 */
export const PROPORTION_OPTIONS: readonly string[] = [
  '',
  'Short',
  'Average',
  'Long',
];

/** Common aesthetic tags the shopper can attach to their profile. Persisted
 *  as a comma-joined string; woven into the prompt as a style direction. */
export const FASHION_STYLE_OPTIONS: readonly string[] = [
  'Streetwear',
  'Minimal',
  'Classic',
  'Athleisure',
  'Vintage',
  'Bohemian',
  'Preppy',
  'Edgy',
  'Formal',
  'Casual',
  'Y2K',
  'Old money',
];
