import { describe, it, expect } from 'vitest';
import { matchHeight, matchWeight, HEIGHT_OPTIONS, WEIGHT_OPTIONS } from './stats';

describe('matchHeight', () => {
  it('parses the formats the inline editor actually receives', () => {
    expect(matchHeight(`5'10"`)?.label).toBe(`5'10"`);
    expect(matchHeight("5' 10")?.label).toBe(`5'10"`);
    expect(matchHeight('5ft10in')?.label).toBe(`5'10"`);
    expect(matchHeight('6 feet')?.label).toBe(`6'0"`);
  });

  it('parses metric and snaps to the nearest inch', () => {
    expect(matchHeight('178cm')?.label).toBe(`5'10"`);
    expect(matchHeight('180 cm')?.label).toBe(`5'11"`);
  });

  it('round-trips its own canonical labels', () => {
    for (const o of HEIGHT_OPTIONS) expect(matchHeight(o.label)?.cm).toBe(o.cm);
  });

  it('returns null rather than guessing on junk', () => {
    expect(matchHeight('')).toBeNull();
    expect(matchHeight('tall')).toBeNull();
    expect(matchHeight('9')).toBeNull(); // bare number: no unit, not a height
  });
});

describe('matchWeight', () => {
  it('treats a bare number as pounds', () => {
    expect(matchWeight('165')?.label).toBe('165 lb (74.8 kg)');
  });

  it('parses explicit units', () => {
    expect(matchWeight('165 lb')?.label).toBe('165 lb (74.8 kg)');
    expect(matchWeight('165lbs')?.label).toBe('165 lb (74.8 kg)');
    expect(matchWeight('75 kg')?.label).toBe('165 lb (74.8 kg)');
  });

  // Regression: the canonical label carries BOTH units. A loose /kg/ test read
  // 165 as kilograms and snapped to the 280 lb ceiling.
  it('reads the unit against the number, not anywhere in the string', () => {
    expect(matchWeight('165 lb (74.8 kg)')?.label).toBe('165 lb (74.8 kg)');
  });

  it('round-trips its own canonical labels', () => {
    for (const o of WEIGHT_OPTIONS) expect(matchWeight(o.label)?.kg).toBe(o.kg);
  });

  it('snaps between 5-lb steps and rejects junk', () => {
    expect(matchWeight('163')?.label).toBe('165 lb (74.8 kg)');
    expect(matchWeight('')).toBeNull();
    expect(matchWeight('heavy')).toBeNull();
  });
});
