import { describe, it, expect } from 'vitest';
import { parseStylistMethod, DEFAULT_STYLIST_ENGINE_METHOD } from './dials';

describe('parseStylistMethod', () => {
  it('returns "legacy" only for the exact string', () => {
    expect(parseStylistMethod('legacy')).toBe('legacy');
  });
  it('returns "stylist_engine" only for the exact string', () => {
    expect(parseStylistMethod('stylist_engine')).toBe('stylist_engine');
  });
  it('defaults to style_engine for anything else', () => {
    expect(DEFAULT_STYLIST_ENGINE_METHOD).toBe('style_engine');
    expect(parseStylistMethod('style_engine')).toBe('style_engine');
    expect(parseStylistMethod(null)).toBe('style_engine');
    expect(parseStylistMethod(undefined)).toBe('style_engine');
    expect(parseStylistMethod('garbage')).toBe('style_engine');
  });
});
