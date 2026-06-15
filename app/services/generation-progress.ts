// generation-progress — shared build-screen vocabulary + progress math for
// an in-flight user_generation. Used by the Generate "building your look"
// screen and the Activity in-progress row so they stay in lockstep.

const TYPICAL_GENERATION_SECONDS_BY_DURATION: Record<number, number> = {
  5: 180,
  10: 360,
};
const TYPICAL_GENERATION_SECONDS_DEFAULT = 180;

// Typical wall-clock generation time keyed by the requested clip length.
// 5s jobs route to Seedance 2 /fast (~180s); 10s jobs route to /pro which is
// materially slower (~360s). The progress bar eases past 95% of whichever
// estimate applies so it never sits at 100% while we're still polling.
export const typicalSecondsFor = (durationSeconds?: number | null): number =>
  TYPICAL_GENERATION_SECONDS_BY_DURATION[durationSeconds ?? 0]
  ?? TYPICAL_GENERATION_SECONDS_DEFAULT;

export const BUILD_PHASES = [
  'Queueing your look',
  'Reading reference photos',
  'Mapping facial features',
  'Locking in proportions',
  'Pulling product details',
  'Composing the outfit',
  'Lighting the scene',
  'Rendering motion frames',
  'Color grading',
  'Final pass',
];

// Rotating "analyzing" one-liners — a words ticker that keeps the wait
// playful. Cosmetic only; cycles independently of the BUILD_PHASES label so
// there's always something moving.
export const BUILD_JOKES = [
  'Analyzing your impeccable taste…',
  'Consulting the fashion oracle…',
  'Steaming the pixels…',
  'Negotiating with the lighting…',
  'Teaching the fabric to drape…',
  'Auditioning camera angles…',
  'Convincing the shoes to behave…',
  'Whispering to the color grade…',
  'Removing the awkward blink…',
  'Tailoring at the speed of light…',
  'Asking the AI to “make it pop”…',
  'Polishing every last thread…',
  // Future-Polaroid jokes (founder's call): the render IS an instant
  // photo from tomorrow — shake accordingly.
  'Shaking it like a Polaroid from 2080…',
  'No peeking — the future is still developing…',
  'Instant film, slightly less instant…',
  'Do not shake the hologram while it develops…',
  'Waiting for the Polaroid to fade in… in 4K…',
];

/** Eased progress for an in-flight generation: linear to 95% across the
 *  typical budget, then a soft asymptote so it never parks at 100%. */
export function generationProgress(
  createdAt: string | number,
  durationSeconds?: number | null,
): { pct: number; phase: string; remainingSec: number } {
  const startedAt = typeof createdAt === 'number' ? createdAt : new Date(createdAt).getTime();
  const elapsedSec = Math.max(0, (Date.now() - startedAt) / 1000);
  const typicalSec = typicalSecondsFor(durationSeconds);
  const linearPct = (elapsedSec / typicalSec) * 95;
  const overflowPct = elapsedSec > typicalSec
    ? 95 + (1 - Math.exp(-(elapsedSec - typicalSec) / 60)) * 4.5
    : linearPct;
  const pct = Math.min(99.5, Math.max(2, overflowPct));
  const phaseIdx = Math.min(BUILD_PHASES.length - 1, Math.floor((pct / 100) * BUILD_PHASES.length));
  const remainingSec = Math.max(0, Math.round(typicalSec - elapsedSec));
  return { pct, phase: BUILD_PHASES[phaseIdx], remainingSec };
}
