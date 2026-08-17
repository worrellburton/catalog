import { describe, it, expect } from 'vitest';
import { roleTagFromName, roleForProduct } from './product-roles';

// Model-named sneakers carry no shoe word, so the NAME heuristic returns null and
// their look-card row loses the "Change" button (the live prod bug). The look card
// now resolves via the governed products.type — roleForProduct must place them.
describe('roleForProduct — model-named shoes via governed type', () => {
  it("places sneakers whose names have no shoe word when type='shoes'", () => {
    for (const name of ['adidas Samba OG - Black', 'Nike Air Force 1 \'07', 'Common Projects Original Achilles Low', 'New Balance 992', 'adidas x Y-3 Superstar']) {
      expect(roleTagFromName(name)).toBeNull();          // name alone can't
      expect(roleForProduct('shoes', name)).toBe('Shoes'); // governed type can
    }
  });
  it('still keeps genuine non-garments out of a slot', () => {
    expect(roleForProduct('skincare', 'Vitamin C Serum')).toBeNull();
  });
});

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
