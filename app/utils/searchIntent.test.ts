import { describe, it, expect } from 'vitest';
import { cleanSearchQuery, funnyCatalogName } from './searchIntent';

describe('cleanSearchQuery', () => {
  it('strips conversational scaffolding', () => {
    expect(cleanSearchQuery('I need a dress for italy')).toBe('dress italy');
    expect(cleanSearchQuery("I'm looking for some shoes")).toBe('shoes');
    expect(cleanSearchQuery('show me a jacket for winter')).toBe('jacket winter');
  });

  it('leaves a clean query mostly intact', () => {
    expect(cleanSearchQuery('vintage denim')).toBe('vintage denim');
  });

  it('never returns empty — falls back to the raw query', () => {
    expect(cleanSearchQuery('for the')).toBe('for the');
  });
});

describe('funnyCatalogName', () => {
  it('is on-topic for garment + context', () => {
    const name = funnyCatalogName('I need a dress for italy');
    expect(name).toMatch(/dress|italy/i);
    expect(name.toLowerCase()).not.toContain('i need');
  });

  it('is deterministic per query (stable across calls)', () => {
    expect(funnyCatalogName('dress for italy')).toBe(funnyCatalogName('dress for italy'));
  });

  it('handles subject-only queries', () => {
    const name = funnyCatalogName('sneakers');
    expect(name).toMatch(/sneakers/i);
  });
});
