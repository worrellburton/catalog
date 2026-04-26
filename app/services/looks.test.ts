import { describe, it, expect } from 'vitest';

/**
 * Tests for the SupabaseLook → Look mapping logic.
 * Extracted here as pure functions so we don't need to mock Supabase.
 *
 * Mirrors the join in app/services/looks.ts where each look pulls its
 * primary creative (looks_creative.is_primary = true) for the video.
 */

// ============================================
// Replicate the mapper from app/services/looks.ts
// ============================================

interface SupabaseLook {
  id: string;
  legacy_id: number | null;
  title: string;
  gender: 'men' | 'women' | 'unisex' | null;
  creator_handle: string | null;
  description: string | null;
  color: string | null;
  status: string | null;
  looks_creative: {
    video_url: string | null;
    thumbnail_url: string | null;
    is_primary: boolean;
  }[];
  look_products: {
    sort_order: number;
    products: {
      name: string;
      brand: string;
      price: string;
      url: string;
      image_url: string;
    } | null;
  }[];
}

interface Look {
  id: number;
  title: string;
  video: string;
  gender: 'men' | 'women';
  creator: string;
  description: string;
  color: string;
  products: {
    name: string;
    brand: string;
    price: string;
    url: string;
    image?: string;
  }[];
}

function filterLiveLooks(data: SupabaseLook[]): SupabaseLook[] {
  return data.filter((row) => {
    const primary = row.looks_creative?.[0];
    return primary?.video_url && (!row.status || row.status === 'live');
  });
}

function mapSupabaseLooks(data: SupabaseLook[]): Look[] {
  const liveLooks = filterLiveLooks(data);
  return liveLooks.map((row, index) => {
    const primary = row.looks_creative[0];
    return {
      id: row.legacy_id ?? -(index + 1),
      title: row.title,
      video: primary.video_url || '',
      gender: (row.gender as 'men' | 'women') || 'women',
      creator: row.creator_handle || '',
      description: row.description || '',
      color: row.color || '#888',
      products: (row.look_products || [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((lp) => ({
          name: lp.products?.name || '',
          brand: lp.products?.brand || '',
          price: lp.products?.price || '',
          url: lp.products?.url || '',
          image: lp.products?.image_url,
        })),
    };
  });
}

// ============================================
// Test Data Factories
// ============================================

function makeLegacyLook(overrides: Partial<SupabaseLook> = {}): SupabaseLook {
  return {
    id: 'aaa-111',
    legacy_id: 1,
    title: 'Look 01',
    gender: 'women',
    creator_handle: '@lilywittman',
    description: 'A curated selection',
    color: '#c4a882',
    status: null,
    looks_creative: [
      { video_url: 'girl2.mp4', thumbnail_url: null, is_primary: true },
    ],
    look_products: [
      {
        sort_order: 0,
        products: {
          name: 'Shoulder Bag',
          brand: 'Zara',
          price: '$49',
          url: 'https://www.zara.com',
          image_url: 'https://example.com/bag.jpg',
        },
      },
    ],
    ...overrides,
  };
}

function makeUserCreatedLook(overrides: Partial<SupabaseLook> = {}): SupabaseLook {
  return {
    id: 'bbb-222',
    legacy_id: null,
    title: 'My New Look',
    gender: 'unisex',
    creator_handle: null,
    description: null,
    color: null,
    status: 'draft',
    looks_creative: [],
    look_products: [],
    ...overrides,
  };
}

// ============================================
// Tests
// ============================================

describe('filterLiveLooks', () => {
  it('includes legacy looks with a primary creative video and no status', () => {
    const looks = [makeLegacyLook()];
    expect(filterLiveLooks(looks)).toHaveLength(1);
  });

  it('includes looks with status=live and a primary creative video', () => {
    const looks = [makeLegacyLook({ status: 'live' })];
    expect(filterLiveLooks(looks)).toHaveLength(1);
  });

  it('excludes draft looks (no primary creative)', () => {
    const looks = [makeUserCreatedLook()];
    expect(filterLiveLooks(looks)).toHaveLength(0);
  });

  it('excludes looks with a primary creative but status=draft', () => {
    const looks = [
      makeUserCreatedLook({
        looks_creative: [{ video_url: 'video.mp4', thumbnail_url: null, is_primary: true }],
        status: 'draft',
      }),
    ];
    expect(filterLiveLooks(looks)).toHaveLength(0);
  });

  it('excludes looks with status=archived', () => {
    const looks = [makeLegacyLook({ status: 'archived' })];
    expect(filterLiveLooks(looks)).toHaveLength(0);
  });

  it('excludes looks with status=denied', () => {
    const looks = [makeLegacyLook({ status: 'denied' })];
    expect(filterLiveLooks(looks)).toHaveLength(0);
  });

  it('handles mix of legacy and user-created looks', () => {
    const looks = [
      makeLegacyLook(),
      makeUserCreatedLook(),
      makeLegacyLook({ id: 'ccc-333', legacy_id: 2, status: 'live' }),
      makeUserCreatedLook({ id: 'ddd-444', status: 'submitted' }),
    ];
    expect(filterLiveLooks(looks)).toHaveLength(2);
  });
});

describe('mapSupabaseLooks', () => {
  it('maps legacy look fields correctly', () => {
    const result = mapSupabaseLooks([makeLegacyLook()]);
    expect(result).toHaveLength(1);
    const look = result[0];
    expect(look.id).toBe(1);
    expect(look.title).toBe('Look 01');
    expect(look.video).toBe('girl2.mp4');
    expect(look.gender).toBe('women');
    expect(look.creator).toBe('@lilywittman');
    expect(look.description).toBe('A curated selection');
    expect(look.color).toBe('#c4a882');
  });

  it('maps products correctly', () => {
    const result = mapSupabaseLooks([makeLegacyLook()]);
    expect(result[0].products).toHaveLength(1);
    expect(result[0].products[0]).toEqual({
      name: 'Shoulder Bag',
      brand: 'Zara',
      price: '$49',
      url: 'https://www.zara.com',
      image: 'https://example.com/bag.jpg',
    });
  });

  it('assigns negative IDs for looks without legacy_id', () => {
    const liveUserLook = makeUserCreatedLook({
      looks_creative: [{ video_url: 'user-video.mp4', thumbnail_url: null, is_primary: true }],
      status: 'live',
    });
    const result = mapSupabaseLooks([liveUserLook]);
    expect(result[0].id).toBe(-1);
  });

  it('defaults gender to women when null', () => {
    const look = makeLegacyLook({ gender: null });
    const result = mapSupabaseLooks([look]);
    expect(result[0].gender).toBe('women');
  });

  it('defaults color to #888 when null', () => {
    const look = makeLegacyLook({ color: null });
    const result = mapSupabaseLooks([look]);
    expect(result[0].color).toBe('#888');
  });

  it('defaults creator to empty string when null', () => {
    const look = makeLegacyLook({ creator_handle: null });
    const result = mapSupabaseLooks([look]);
    expect(result[0].creator).toBe('');
  });

  it('defaults description to empty string when null', () => {
    const look = makeLegacyLook({ description: null });
    const result = mapSupabaseLooks([look]);
    expect(result[0].description).toBe('');
  });

  it('handles null products gracefully (no crash)', () => {
    const look = makeLegacyLook({
      look_products: [{ sort_order: 0, products: null }],
    });
    const result = mapSupabaseLooks([look]);
    expect(result[0].products[0]).toEqual({
      name: '',
      brand: '',
      price: '',
      url: '',
      image: undefined,
    });
  });

  it('handles empty look_products array', () => {
    const look = makeLegacyLook({ look_products: [] });
    const result = mapSupabaseLooks([look]);
    expect(result[0].products).toEqual([]);
  });

  it('sorts products by sort_order', () => {
    const look = makeLegacyLook({
      look_products: [
        { sort_order: 2, products: { name: 'C', brand: '', price: '', url: '', image_url: '' } },
        { sort_order: 0, products: { name: 'A', brand: '', price: '', url: '', image_url: '' } },
        { sort_order: 1, products: { name: 'B', brand: '', price: '', url: '', image_url: '' } },
      ],
    });
    const result = mapSupabaseLooks([look]);
    expect(result[0].products.map(p => p.name)).toEqual(['A', 'B', 'C']);
  });

  it('filters out all non-displayable looks and returns empty array', () => {
    const result = mapSupabaseLooks([
      makeUserCreatedLook(),
      makeUserCreatedLook({ id: 'x', status: 'submitted' }),
    ]);
    expect(result).toEqual([]);
  });
});
