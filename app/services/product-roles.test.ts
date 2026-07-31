import { describe, it, expect } from 'vitest';
import { roleTagFromName } from './product-roles';

// The bug: plural footwear product names ("Sneakers", "Boots") returned null,
// so their look-card row lost its "Change" button. Singular garment words
// ("Shirt", "Pant") always worked — hence the inconsistency the founder saw.
describe('roleTagFromName — plural footwear', () => {
  it('classifies plural footwear the same as singular', () => {
    for (const name of [
      'Awearness Kenneth Cole Pebble Grain Leather Sneakers in White',
      'Chelsea Boots', 'Suede Loafers', 'Leather Sandals', 'Canvas Trainers',
    ]) {
      expect(roleTagFromName(name)).toBe('Shoes');
    }
  });

  it('still classifies the singular forms + the other slots', () => {
    expect(roleTagFromName('Joseph Abboud Linen Camp Collar Shirt')).toBe('Top');
    expect(roleTagFromName('Relaxed Linen Pant - Self Pigment')).toBe('Pants');
    expect(roleTagFromName('Suede Chelsea Boot')).toBe('Shoes');
  });

  it("doesn't false-match near-miss words", () => {
    expect(roleTagFromName('Shoehorn')).toBeNull();
    expect(roleTagFromName('Bootcut Jean')).toBe('Pants'); // Jean wins, not Boot
    expect(roleTagFromName('Ceramic Vase')).toBeNull();
  });
});
