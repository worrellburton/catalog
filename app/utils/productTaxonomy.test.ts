import { describe, it, expect } from 'vitest';
import {
  isFitRelevant,
  deriveFitLabel,
  buildSuggestionChipGroups,
} from './productTaxonomy';
import type { FitIntelligence, StylingMetadata } from '~/services/product-details';

// Real-shaped fixtures pulled from the products table.
const sambaFit: FitIntelligence = {
  fit_type: 'regular',
  body_type_match: ['lean', 'athletic', 'average', 'broad', 'petite', 'tall'],
  layering: false,
  warmth_rating: 'low',
  stretch_behavior: 'minimal',
  likely_feel: 'structured',
  true_to_size: 'true_to_size',
  best_for_occasions: ['casual', 'active', 'lounge'],
  season: ['spring', 'summer', 'fall', 'winter'],
};
const sambaStyling: StylingMetadata = {
  works_with: ['slim fit jeans', 'track pants', 'casual chinos', 'crew neck sweatshirt', 'graphic tees'],
  occasion: ['casual everyday wear', 'gym and workout', 'weekend errands', 'office casual', 'skateboarding', 'street style'],
  season: ['spring', 'summer', 'fall', 'winter'],
};
const bookFit: FitIntelligence = {
  fit_type: 'not_applicable',
  body_type_match: ['not_applicable'],
  layering: false,
  warmth_rating: 'not_applicable',
  stretch_behavior: 'not_applicable',
  likely_feel: 'not_applicable',
  true_to_size: 'not_applicable',
  best_for_occasions: ['casual', 'lounge'],
  season: ['spring', 'summer', 'fall', 'winter'],
};
const bookStyling: StylingMetadata = {
  works_with: ['cozy throw blanket', 'reading light', 'bookmark', 'hot beverage mug', 'reading journal'],
  occasion: ['book club', 'beach read', 'cozy weekend read', 'commute reading', 'relaxing evening'],
  season: ['spring', 'summer', 'fall', 'winter'],
};

describe('isFitRelevant', () => {
  it('uses fit_type as the strongest signal', () => {
    expect(isFitRelevant('footwear', sambaFit)).toBe(true);
    expect(isFitRelevant('books', bookFit)).toBe(false);
  });

  it('falls back to the category set when fit_intelligence is absent', () => {
    expect(isFitRelevant('tops', null)).toBe(true);
    expect(isFitRelevant('dresses', null)).toBe(true);
    expect(isFitRelevant('books', null)).toBe(false);
    expect(isFitRelevant('kitchenware', null)).toBe(false);
    // Accessories/jewelry have no garment fit → excluded.
    expect(isFitRelevant('jewelry', null)).toBe(false);
  });

  it('treats unknown (no category, no fit_intelligence) as non-fashion', () => {
    expect(isFitRelevant(null, null)).toBe(false);
  });
});

describe('deriveFitLabel', () => {
  it('humanizes the true_to_size enum without leaking underscores', () => {
    expect(deriveFitLabel(sambaFit)).toBe('Regular fit · True to size');
  });

  it('phrases runs_small / size_up as clauses', () => {
    expect(deriveFitLabel({ ...sambaFit, fit_type: 'slim', true_to_size: 'runs_small' }))
      .toBe('Slim fit · Runs small');
    expect(deriveFitLabel({ ...sambaFit, fit_type: 'relaxed', true_to_size: 'size_up' }))
      .toBe('Relaxed fit · Size up');
  });

  it('returns null for non-apparel', () => {
    expect(deriveFitLabel(bookFit)).toBeNull();
    expect(deriveFitLabel(null)).toBeNull();
  });
});

describe('buildSuggestionChipGroups', () => {
  it('builds occasion + suits + season + style for a fashion item', () => {
    const groups = buildSuggestionChipGroups({ fitIntel: sambaFit, styling: sambaStyling, fitRelevant: true });
    const byKey = Object.fromEntries(groups.map(g => [g.key, g]));

    expect(groups.map(g => g.key)).toEqual(['occasion', 'suits', 'season', 'pairs']);
    // Occasion capped at 5 and sentence-cased.
    expect(byKey.occasion.items).toEqual([
      'Casual everyday wear', 'Gym and workout', 'Weekend errands', 'Office casual', 'Skateboarding',
    ]);
    // Body-type chips capped at 4 (the age-proxy).
    expect(byKey.suits.items).toEqual(['Lean', 'Athletic', 'Average', 'Broad']);
    expect(byKey.season.items).toEqual(['Spring', 'Summer', 'Fall', 'Winter']);
    expect(byKey.pairs.items).toHaveLength(4);
  });

  it('omits the apparel-only "Suits" group for non-fashion but keeps universal chips', () => {
    const groups = buildSuggestionChipGroups({ fitIntel: bookFit, styling: bookStyling, fitRelevant: false });
    expect(groups.map(g => g.key)).toEqual(['occasion', 'season', 'pairs']);
    expect(groups.find(g => g.key === 'suits')).toBeUndefined();
    expect(groups[0].items[0]).toBe('Book club');
  });

  it('drops not_applicable / blank / duplicate values', () => {
    const groups = buildSuggestionChipGroups({
      fitIntel: { ...bookFit, body_type_match: ['not_applicable'] },
      styling: { works_with: [], occasion: ['date night', 'Date night', '', 'date night'], season: [] },
      fitRelevant: true,
    });
    const occasion = groups.find(g => g.key === 'occasion');
    expect(occasion?.items).toEqual(['Date night']); // deduped case-insensitively
    expect(groups.find(g => g.key === 'suits')).toBeUndefined(); // only not_applicable → dropped
  });

  it('returns an empty array when there is no metadata', () => {
    expect(buildSuggestionChipGroups({ fitIntel: null, styling: null, fitRelevant: true })).toEqual([]);
  });
});
