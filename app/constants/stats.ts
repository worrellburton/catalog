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
