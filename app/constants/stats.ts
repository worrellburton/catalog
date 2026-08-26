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

/**
 * Free-text → option matchers. The Style chat's inline stats editor takes
 * height/weight as typed text (the onboarding flow uses the dropdowns above),
 * so the label alone reaches `profiles`. Readers that bind to the numeric
 * columns — ProfilePage's Body-profile selects bind to `height_cm`/`weight_kg`
 * — then render "Select" as if nothing was saved. These snap typed text to the
 * nearest option so both columns get written from either surface.
 *
 * Nearest-match, not exact: the option sets are 1" and 5-lb steps, so "163 lb"
 * has no exact row but is unambiguously the 165 lb one.
 */

/** Height in cm from `5'10"`, `5' 10`, `5ft10in`, `178cm`. Null if unparseable. */
export function matchHeight(text: string): HeightOption | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const cm = /^(\d{2,3})\s*cm\b/.exec(t);
  const ftIn = /^(\d)\s*(?:'|’|ft|feet|foot)\s*(\d{1,2})?/.exec(t);
  const target = cm ? Number(cm[1])
    : ftIn ? (Number(ftIn[1]) * 12 + Number(ftIn[2] ?? 0)) * 2.54
    : null;
  return target === null ? null : nearest(HEIGHT_OPTIONS, o => o.cm, target);
}

/** Weight in kg from `165 lb`, `165lbs`, `165`, `75 kg`. Null if unparseable. */
export function matchWeight(text: string): WeightOption | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  // The unit must sit against the number, not merely appear somewhere in the
  // string: the canonical labels read "165 lb (74.8 kg)", so a loose /kg/ test
  // would read 165 as kilograms and snap to the top of the range.
  const m = /^(\d{2,3}(?:\.\d+)?)\s*(kgs?|kilos?|lbs?|pounds?)?/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  // Bare numbers are pounds — the labels are imperial-first because that's how
  // shoppers self-report here.
  const kg = /^k/.test(m[2] ?? '') ? n : n * 0.45359237;
  return nearest(WEIGHT_OPTIONS, o => o.kg, kg);
}

function nearest<T>(options: T[], value: (o: T) => number, target: number): T {
  return options.reduce((best, o) =>
    Math.abs(value(o) - target) < Math.abs(value(best) - target) ? o : best);
}
