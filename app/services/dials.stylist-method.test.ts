import { describe, it, expect } from 'vitest';
import { parseStylistMethod, DEFAULT_STYLIST_ENGINE_METHOD } from './dials';

describe('parseStylistMethod', () => {
  it('returns "legacy" only for the exact string', () => {
    expect(parseStylistMethod('legacy')).toBe('legacy');
  });
  it('defaults to stylist_engine for anything else (incl. the retired style_engine)', () => {
    expect(DEFAULT_STYLIST_ENGINE_METHOD).toBe('stylist_engine');
    expect(parseStylistMethod('stylist_engine')).toBe('stylist_engine');
    expect(parseStylistMethod('style_engine')).toBe('stylist_engine'); // retired name -> new default
    expect(parseStylistMethod(null)).toBe('stylist_engine');
    expect(parseStylistMethod(undefined)).toBe('stylist_engine');
    expect(parseStylistMethod('garbage')).toBe('stylist_engine');
  });
});
