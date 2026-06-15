import { describe, it, expect } from 'vitest';
import { inferRoleFromName, sortByGarmentRole, ROLE_PRIORITY } from './garmentOrder';

describe('inferRoleFromName — singular names', () => {
  const cases: Array<[string, string]> = [
    ['Wool Fedora', 'hat'],
    ['Baseball Cap', 'hat'],
    ['Silk Scarf', 'scarf'],
    ['Bomber Jacket', 'jacket'],
    ['Trench Coat', 'jacket'],
    ['Maxi Dress', 'dress'],
    ['Pleated Skirt', 'skirt'],
    ['Leather Belt', 'belt'],
    ['Canvas Tote Bag', 'bag'],
    ['Cotton Shirt', 'top'],
    ['Cashmere Sweater', 'top'],
    ['Apple Watch', 'watch'],
  ];
  it.each(cases)('classifies %s as %s', (name, role) => {
    expect(inferRoleFromName(name)).toBe(role);
  });
});

describe('inferRoleFromName — plural names (the common catalog form)', () => {
  // Fashion products are overwhelmingly listed in the plural. These must
  // classify the same as their singular form, not fall through to "other".
  const cases: Array<[string, string]> = [
    ['Ray-Ban Sunglasses', 'sunglasses'],
    ['Cargo Shorts', 'shorts'],
    ['Bermuda Shorts', 'shorts'],
    ['Blue Jeans', 'pants'],
    ['Cargo Pants', 'pants'],
    ['Slim Chinos', 'pants'],
    ['Wool Trousers', 'pants'],
    ['Knit Joggers', 'pants'],
    ['Black Leggings', 'pants'],
    ['Running Sneakers', 'shoes'],
    ['Chelsea Boots', 'shoes'],
    ['Leather Loafers', 'shoes'],
    ['Strappy Sandals', 'shoes'],
    ['Block Heels', 'shoes'],
    ['Gold Earrings', 'jewelry'],
    ['Stacking Rings', 'jewelry'],
    ['Smart Watches', 'watch'],
    ['Graphic Tees', 'top'],
    ['Pencil Skirts', 'skirt'],
    ['Leather Belts', 'belt'],
  ];
  it.each(cases)('classifies %s as %s', (name, role) => {
    expect(inferRoleFromName(name)).toBe(role);
  });
});

describe('inferRoleFromName — no recognisable role', () => {
  it('returns null for unrecognised or empty names', () => {
    expect(inferRoleFromName('Mystery Object')).toBeNull();
    expect(inferRoleFromName('')).toBeNull();
    expect(inferRoleFromName(null)).toBeNull();
    expect(inferRoleFromName(undefined)).toBeNull();
  });
});

describe('sortByGarmentRole', () => {
  it('orders items head-to-toe by canonical role priority', () => {
    const input = [
      { name: 'Running Sneakers' }, // shoes (70)
      { name: 'Wool Fedora' },      // hat (10)
      { name: 'Cotton Shirt' },     // top (40)
      { name: 'Blue Jeans' },       // pants (60)
    ];
    expect(sortByGarmentRole(input).map(p => p.name)).toEqual([
      'Wool Fedora', 'Cotton Shirt', 'Blue Jeans', 'Running Sneakers',
    ]);
  });

  it('lets an explicit role_tag override name inference', () => {
    const input = [
      { name: 'Mystery Object', role_tag: 'hat' }, // forced to top of order
      { name: 'Cotton Shirt' },                    // top (40)
    ];
    expect(sortByGarmentRole(input).map(p => p.name)).toEqual([
      'Mystery Object', 'Cotton Shirt',
    ]);
  });

  it('sends unrecognised items to the bottom, preserving their original order', () => {
    const input = [
      { name: 'Widget' },        // unknown → 999
      { name: 'Gadget' },        // unknown → 999
      { name: 'Wool Fedora' },   // hat → 10
    ];
    expect(sortByGarmentRole(input).map(p => p.name)).toEqual([
      'Wool Fedora', 'Widget', 'Gadget',
    ]);
  });

  it('is a stable sort within the same role priority', () => {
    const input = [
      { name: 'Cotton Shirt', id: 1 },   // top (40)
      { name: 'Cashmere Sweater', id: 2 }, // top (40)
      { name: 'Linen Top', id: 3 },      // top (40)
    ];
    expect(sortByGarmentRole(input).map(p => p.id)).toEqual([1, 2, 3]);
  });

  it('does not mutate the input array', () => {
    const input = [{ name: 'Running Sneakers' }, { name: 'Wool Fedora' }];
    const snapshot = input.map(p => p.name);
    sortByGarmentRole(input);
    expect(input.map(p => p.name)).toEqual(snapshot);
  });
});

describe('ROLE_PRIORITY', () => {
  it('encodes a strict head-to-toe ordering', () => {
    expect(ROLE_PRIORITY.hat).toBeLessThan(ROLE_PRIORITY.top);
    expect(ROLE_PRIORITY.top).toBeLessThan(ROLE_PRIORITY.pants);
    expect(ROLE_PRIORITY.pants).toBeLessThan(ROLE_PRIORITY.shoes);
    expect(ROLE_PRIORITY.shoes).toBeLessThan(ROLE_PRIORITY.jewelry);
  });
});
