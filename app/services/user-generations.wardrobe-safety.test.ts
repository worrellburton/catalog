import { describe, it, expect } from 'vitest';
import { buildGenerationPrompt } from './user-generations';

// Phase 5: no rendered look should ever ship copy that reads as nudity.
// The base prompt asserts it globally, and computeProductOnlyWardrobe
// fills every uncovered zone with tank / bra / white underwear / leaves.
// If any of these branches regress, this test dies loudly before a look
// generation is queued.
describe('buildGenerationPrompt — no nudity in any branch', () => {
  const base = {
    heightLabel: "5'10\"",
    style: 'commercial',
    productLines: [] as { role_tag: string | null; brand: string | null; name: string | null }[],
    durationSeconds: 5,
  };
  // Descriptive-nudity phrases only — the base safety clause legitimately
  // contains "nude" + "topless" inside a negation ("Never render the subject
  // nude, topless, ..."). Strip that safety sentence before scanning so we're
  // asserting on the rest of the prompt only.
  const NAKED_PHRASES = /bare\s+torso|bare\s+chest|bare\s+legs|bare\s+bottom|topless|shirtless|\bnude\b/i;
  const stripSafetyClause = (s: string) =>
    s.replace(/Never render the subject nude[^.]*\./i, '');

  it('bans nudity globally in the base wardrobe clause', () => {
    const prompt = buildGenerationPrompt({ ...base, productLines: [
      { role_tag: 'shoes', brand: null, name: 'Trainer' },
    ]});
    expect(prompt).toMatch(/Never render the subject nude/);
    expect(stripSafetyClause(prompt)).not.toMatch(NAKED_PHRASES);
  });

  it('male + bottom, no top -> tank, never bare torso', () => {
    const prompt = buildGenerationPrompt({ ...base, gender: 'male', productLines: [
      { role_tag: 'pants', brand: null, name: 'Chinos' },
    ]});
    expect(prompt).not.toMatch(/bare\s+torso/i);
    expect(prompt).toMatch(/white tank/i);
  });

  it('female + top, no bottom -> white briefs or leaves, never bare legs', () => {
    const prompt = buildGenerationPrompt({ ...base, gender: 'female', productLines: [
      { role_tag: 'top', brand: null, name: 'Blouse' },
    ]});
    expect(prompt).not.toMatch(/bare\s+legs/i);
    expect(prompt).toMatch(/white briefs/i);
    expect(prompt).toMatch(/leaves/i);
  });

  it('male + top, no bottom -> boxer-briefs or leaves', () => {
    const prompt = buildGenerationPrompt({ ...base, gender: 'male', productLines: [
      { role_tag: 'top', brand: null, name: 'T-Shirt' },
    ]});
    expect(prompt).toMatch(/boxer-briefs/i);
    expect(prompt).toMatch(/leaves/i);
  });
});
