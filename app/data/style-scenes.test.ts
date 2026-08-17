import { describe, it, expect } from 'vitest';
import { presetForPhrase, SCENE_PRESETS } from './style-scenes';

describe('presetForPhrase', () => {
  it('maps an exact autoScene phrase to its preset', () => {
    expect(presetForPhrase('a candlelit restaurant')?.id).toBe('restaurant');
    expect(presetForPhrase('a bright modern office')?.id).toBe('office');
  });

  it('maps a rich non-verbatim guess by keyword', () => {
    expect(presetForPhrase('a warm restaurant at night')?.id).toBe('restaurant');
    expect(presetForPhrase('a sunlit boardwalk by the sea')?.id).toBe('beach');
    expect(presetForPhrase('a rooftop at golden hour')?.id).toBe('rooftop');
  });

  it('returns null for a guess with no preset (→ leading Suggested card)', () => {
    expect(presetForPhrase('running errands around town')).not.toBeNull(); // "town" → street
    expect(presetForPhrase('a sunlit mountain trail')).toBeNull();
    expect(presetForPhrase('a bright modern gym')).toBeNull();
    expect(presetForPhrase('')).toBeNull();
    expect(presetForPhrase(null)).toBeNull();
  });

  it('every preset phrase round-trips to itself', () => {
    for (const s of SCENE_PRESETS) expect(presetForPhrase(s.phrase)?.id).toBe(s.id);
  });
});
