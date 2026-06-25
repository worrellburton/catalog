import { describe, it, expect } from 'vitest';
import { cleanSearchQuery, funnyCatalogName, searchFallbackQuery, isConversationalQuery, searchSubject } from './searchIntent';

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

  it('stays punchy on a long rambling query (no runaway title)', () => {
    const name = funnyCatalogName('dress for a summer wedding in tuscany italy with my family');
    expect(name.length).toBeLessThan(60);
  });
});

describe('isConversationalQuery', () => {
  it('flags conversational asks (opener phrase, occasion, or rambling)', () => {
    expect(isConversationalQuery('I want to dress for this')).toBe(true);
    expect(isConversationalQuery('outfit for a wedding')).toBe(true);
    expect(isConversationalQuery('something cozy to wear on a rainy day')).toBe(true);
  });

  it('treats short direct product searches as NOT conversational', () => {
    expect(isConversationalQuery('black shoes')).toBe(false);
    expect(isConversationalQuery('vintage denim')).toBe(false);
    expect(isConversationalQuery('Nike')).toBe(false);
  });
});

describe('searchSubject', () => {
  it('returns the lowercased garment subject when present', () => {
    expect(searchSubject('I want a dress for italy')).toBe('dresses');
    expect(searchSubject('cool sneakers')).toBe('sneakers');
  });

  it('returns null when no known garment is present', () => {
    expect(searchSubject('something for a wedding')).toBeNull();
    expect(searchSubject('quiet luxury')).toBeNull();
  });
});

describe('searchFallbackQuery', () => {
  it('falls back to the bare garment when a contextual query is empty', () => {
    expect(searchFallbackQuery('dress italy')).toBe('dress');
    expect(searchFallbackQuery('jacket winter')).toBe('jacket');
  });

  it('returns null when there is nothing broader to try', () => {
    expect(searchFallbackQuery('dress')).toBeNull();   // single token
    expect(searchFallbackQuery('quiet luxury')).toBeNull(); // no recognized garment
  });
});
