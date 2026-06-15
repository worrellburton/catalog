import { describe, it, expect } from 'vitest';
import {
  kebab,
  uuidPrefix,
  productSlug,
  lookSlug,
  brandSlug,
  creatorSlug,
  nextHexPrefix,
  extractIdPrefix,
  extractLookId,
} from './slug';

// A canonical v4-shaped UUID whose first octet is `1a2b3c4d`.
const UUID = '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d';

describe('kebab', () => {
  it('returns empty string for empty / falsy input', () => {
    expect(kebab('')).toBe('');
  });

  it('lowercases and hyphenates words', () => {
    expect(kebab('Air Max')).toBe('air-max');
  });

  it('folds accents to ASCII (café → cafe)', () => {
    expect(kebab('Café Society')).toBe('cafe-society');
  });

  it('drops punctuation, keeping letters and digits', () => {
    expect(kebab("Levi's 501® Jeans")).toBe('levi-s-501-jeans');
  });

  it('strips stopwords (the, a, an, of, and, or, for)', () => {
    expect(kebab('The Art of War')).toBe('art-war');
    expect(kebab('Salt and Pepper')).toBe('salt-pepper');
  });

  it('collapses runs of whitespace and hyphens into a single hyphen', () => {
    expect(kebab('  blue   --  suede  ')).toBe('blue-suede');
  });

  it('returns empty string when the input is entirely stopwords', () => {
    expect(kebab('the a of and')).toBe('');
  });

  it('caps at 80 chars and never leaves a trailing hyphen after the cut', () => {
    // 25 × "abc" pre-slice is 99 chars; the 80-char cut lands exactly on a
    // hyphen, which the trailing-hyphen strip must remove → 20 clean words.
    const out = kebab(Array(25).fill('abc').join(' '));
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith('-')).toBe(false);
    expect(out).toBe(Array(20).fill('abc').join('-'));
  });
});

describe('uuidPrefix', () => {
  it('returns the first 8 hex chars with hyphens removed', () => {
    expect(uuidPrefix(UUID)).toBe('1a2b3c4d');
  });

  it('returns empty string for empty input', () => {
    expect(uuidPrefix('')).toBe('');
  });
});

describe('productSlug', () => {
  it('combines brand + name with the uuid prefix suffix', () => {
    expect(productSlug({ id: UUID, brand: 'Nike', name: 'Air Max' }))
      .toBe('nike-air-max-1a2b3c4d');
  });

  it('falls back to the bare prefix when there is no human label', () => {
    expect(productSlug({ id: UUID, brand: '', name: '' })).toBe('1a2b3c4d');
  });

  it('returns the human label alone when there is no id', () => {
    expect(productSlug({ brand: 'Nike', name: 'Air Max' })).toBe('nike-air-max');
  });

  it('returns empty string when there is nothing to slug', () => {
    expect(productSlug({})).toBe('');
  });
});

describe('lookSlug', () => {
  it('prefers the uuid suffix over a numeric id', () => {
    expect(lookSlug({ id: -42, uuid: UUID, creator: 'jane', title: 'Quiet Luxury' }))
      .toBe('jane-quiet-luxury-1a2b3c4d');
  });

  it('uses a numeric id verbatim when no uuid is present', () => {
    expect(lookSlug({ id: 7, creator: 'jane', title: 'Quiet Luxury' }))
      .toBe('jane-quiet-luxury-7');
  });

  it('hashes a non-numeric string id through uuidPrefix', () => {
    expect(lookSlug({ id: UUID, creator: 'jane', title: 'Quiet Luxury' }))
      .toBe('jane-quiet-luxury-1a2b3c4d');
  });

  it('prefers the display name over a synthetic user: creator placeholder', () => {
    // Orphan looks carry `user:<uuid>` in `creator`; the slug must not leak
    // the raw uuid into the human portion.
    expect(lookSlug({
      id: 9,
      creator: `user:${UUID}`,
      creatorDisplayName: 'Jane Hamilton',
      title: 'Soft Tailoring',
    })).toBe('jane-hamilton-soft-tailoring-9');
  });

  it('returns empty string when there is nothing to slug', () => {
    expect(lookSlug({})).toBe('');
  });
});

describe('brandSlug', () => {
  it('is just the kebab of the brand', () => {
    expect(brandSlug('Acne Studios')).toBe('acne-studios');
  });
});

describe('creatorSlug', () => {
  it('kebabs a real handle and strips a leading @', () => {
    expect(creatorSlug('@LilyTheGreat')).toBe('lilythegreat');
  });

  it('renders synthetic user: keys as a stable u-<prefix>', () => {
    expect(creatorSlug(`user:${UUID}`)).toBe('u-1a2b3c4d');
  });

  it('returns empty string for empty input', () => {
    expect(creatorSlug('')).toBe('');
  });
});

describe('nextHexPrefix', () => {
  it('increments an 8-char hex prefix', () => {
    expect(nextHexPrefix('1a2b3c4d')).toBe('1a2b3c4e');
  });

  it('zero-pads the incremented value to 8 chars', () => {
    expect(nextHexPrefix('00000000')).toBe('00000001');
  });

  it('rolls the last representable prefix up cleanly', () => {
    expect(nextHexPrefix('fffffffe')).toBe('ffffffff');
  });

  it('returns null on overflow (all-f prefix)', () => {
    expect(nextHexPrefix('ffffffff')).toBeNull();
  });
});

describe('extractIdPrefix', () => {
  it('pulls the trailing 8-char hex octet off a product slug', () => {
    expect(extractIdPrefix('nike-air-max-1a2b3c4d')).toBe('1a2b3c4d');
  });

  it('matches a bare prefix with no human portion', () => {
    expect(extractIdPrefix('1a2b3c4d')).toBe('1a2b3c4d');
  });

  it('lowercases the captured prefix', () => {
    expect(extractIdPrefix('NIKE-AABBCCDD')).toBe('aabbccdd');
  });

  it('returns null when the slug has no trailing hex octet', () => {
    expect(extractIdPrefix('nike-air-max')).toBeNull();
    expect(extractIdPrefix('product-12345')).toBeNull(); // 5 digits, not 8 hex
    expect(extractIdPrefix('')).toBeNull();
  });
});

describe('extractLookId', () => {
  it('pulls a trailing numeric id', () => {
    expect(extractLookId('quiet-luxury-1')).toBe(1);
    expect(extractLookId('quiet-luxury-123')).toBe(123);
  });

  it('captures only the trailing segment, not numbers inside the human part', () => {
    expect(extractLookId('best-of-2024-5')).toBe(5);
  });

  it('matches a bare numeric slug', () => {
    expect(extractLookId('42')).toBe(42);
  });

  it('returns null when there is no trailing numeric id', () => {
    expect(extractLookId('quiet-luxury')).toBeNull();
    expect(extractLookId('')).toBeNull();
  });
});

// The resolver round-trips slugs back into lookup keys on cold load
// (useOverlayRouter). These properties are the real contract: a minted
// slug must resolve back to the identifier it was minted from.
describe('round-trip contract', () => {
  it('extractIdPrefix recovers uuidPrefix from a product slug', () => {
    const slug = productSlug({ id: UUID, brand: 'Nike', name: 'Air Max' });
    expect(extractIdPrefix(slug)).toBe(uuidPrefix(UUID));
  });

  it('extractLookId recovers a numeric look id from its slug', () => {
    const slug = lookSlug({ id: 7, creator: 'jane', title: 'Quiet Luxury' });
    expect(extractLookId(slug)).toBe(7);
  });

  it('nextHexPrefix yields an upper bound strictly above the prefix (range-scan invariant)', () => {
    const prefix = '1a2b3c4d';
    const next = nextHexPrefix(prefix)!;
    // Equal-length lowercase hex compares lexically the same as numerically,
    // so the gte/lt UUID range bounds stay correctly ordered.
    expect(prefix < next).toBe(true);
  });
});
