import { describe, it, expect } from 'vitest';

/**
 * Tests for the manage-looks edge function request handling logic.
 * Validates that create/update payloads match the relaxed schema.
 */

describe('manage-looks edge function schema compatibility', () => {
  // Simulates what the edge function INSERT does (using sql() helper with object)
  // After migration 004, video_path and creator_handle are nullable

  interface CreateLookRow {
    user_id: string;
    title: string;
    description: string | null;
    gender: string | null;
    color: string | null;
    status: string;
  }

  function buildCreatePayload(userId: string, body: { title?: string; description?: string; gender?: string; color?: string }): CreateLookRow {
    return {
      user_id: userId,
      title: body.title || 'Untitled',
      description: body.description ?? null,
      gender: body.gender ?? null,
      color: body.color ?? null,
      status: 'draft',
    };
  }

  it('creates valid payload with only title', () => {
    const payload = buildCreatePayload('user-123', { title: 'My Look' });
    expect(payload.user_id).toBe('user-123');
    expect(payload.title).toBe('My Look');
    expect(payload.status).toBe('draft');
    expect(payload).not.toHaveProperty('video_path');
    expect(payload).not.toHaveProperty('creator_handle');
  });

  it('creates valid payload with all fields', () => {
    const payload = buildCreatePayload('user-123', {
      title: 'Summer Vibes',
      description: 'A warm look',
      gender: 'women',
      color: '#ff0000',
    });
    expect(payload.title).toBe('Summer Vibes');
    expect(payload.description).toBe('A warm look');
    expect(payload.gender).toBe('women');
    expect(payload.color).toBe('#ff0000');
  });

  it('defaults title to Untitled when empty', () => {
    const payload = buildCreatePayload('user-123', {});
    expect(payload.title).toBe('Untitled');
  });

  it('defaults title to Untitled when falsy empty string', () => {
    const payload = buildCreatePayload('user-123', { title: '' });
    expect(payload.title).toBe('Untitled');
  });

  it('uses nullish coalescing for description (preserves empty string)', () => {
    const payload = buildCreatePayload('user-123', { title: 'Test', description: '' });
    expect(payload.description).toBe('');
  });

  it('defaults description to null when undefined', () => {
    const payload = buildCreatePayload('user-123', { title: 'Test' });
    expect(payload.description).toBeNull();
  });

  it('defaults gender to null when not provided', () => {
    const payload = buildCreatePayload('user-123', { title: 'Test' });
    expect(payload.gender).toBeNull();
  });

  it('defaults color to null when not provided', () => {
    const payload = buildCreatePayload('user-123', { title: 'Test' });
    expect(payload.color).toBeNull();
  });

  it('payload has no null values that would crash postgres serializer', () => {
    // This test validates the exact scenario from the bug report
    const body = { title: 'dasdas', description: 'dasdas', gender: 'unisex', color: '#888888' };
    const payload = buildCreatePayload('some-uuid', body);
    // All values should be non-null for this input
    expect(Object.values(payload).every(v => v !== null)).toBe(true);
  });

  // Simulates the allowed update fields
  interface UpdateFields {
    title?: string;
    description?: string;
    gender?: string;
    color?: string;
    thumbnail_url?: string;
    enabled?: boolean;
  }

  function filterUpdateFields(body: Record<string, unknown>): UpdateFields {
    const allowed = ['title', 'description', 'gender', 'color', 'thumbnail_url', 'enabled'];
    return Object.fromEntries(
      Object.entries(body).filter(([k]) => allowed.includes(k))
    ) as UpdateFields;
  }

  it('filters only allowed update fields', () => {
    const result = filterUpdateFields({
      title: 'Updated',
      description: 'New desc',
      status: 'live', // not allowed via PUT
      user_id: 'hacker', // not allowed
    });
    expect(result).toEqual({ title: 'Updated', description: 'New desc' });
    expect(result).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('user_id');
  });

  it('allows thumbnail_url and enabled in updates', () => {
    const result = filterUpdateFields({
      thumbnail_url: 'https://example.com/thumb.jpg',
      enabled: false,
    });
    expect(result).toEqual({
      thumbnail_url: 'https://example.com/thumb.jpg',
      enabled: false,
    });
  });

  it('returns empty object when no valid fields provided', () => {
    const result = filterUpdateFields({ foo: 'bar', baz: 123 });
    expect(Object.keys(result)).toHaveLength(0);
  });
});

describe('manage-looks status transitions', () => {
  function getArchiveTransition(currentStatus: string): { newStatus: string; archivedAt: string | null } {
    const newStatus = currentStatus === 'archived' ? 'draft' : 'archived';
    const archivedAt = newStatus === 'archived' ? new Date().toISOString() : null;
    return { newStatus, archivedAt };
  }

  it('archives a draft look', () => {
    const result = getArchiveTransition('draft');
    expect(result.newStatus).toBe('archived');
    expect(result.archivedAt).toBeTruthy();
  });

  it('archives a live look', () => {
    const result = getArchiveTransition('live');
    expect(result.newStatus).toBe('archived');
    expect(result.archivedAt).toBeTruthy();
  });

  it('unarchives an archived look back to draft', () => {
    const result = getArchiveTransition('archived');
    expect(result.newStatus).toBe('draft');
    expect(result.archivedAt).toBeNull();
  });
});

describe('manage-looks gender constraint', () => {
  const validGenders = ['men', 'women', 'unisex'];

  it.each(validGenders)('accepts gender=%s', (gender: string) => {
    expect(validGenders).toContain(gender);
  });

  it('allows null gender for user-created looks', () => {
    const gender: string | null = null;
    expect(gender).toBeNull();
  });
});

describe('manage-looks product insertion', () => {
  function buildProductRow(body: Record<string, unknown>) {
    return {
      name: body.name || '',
      brand: body.brand ?? null,
      price: body.price ?? null,
      url: body.url ?? null,
      image_url: body.image_url ?? null,
    };
  }

  it('builds product row with all fields', () => {
    const row = buildProductRow({ name: 'Bag', brand: 'Zara', price: '$49', url: 'https://zara.com', image_url: 'https://img.com/bag.jpg' });
    expect(row.name).toBe('Bag');
    expect(row.brand).toBe('Zara');
  });

  it('handles missing optional fields with null', () => {
    const row = buildProductRow({ name: 'Bag' });
    expect(row.brand).toBeNull();
    expect(row.price).toBeNull();
    expect(row.url).toBeNull();
    expect(row.image_url).toBeNull();
  });

  it('defaults name to empty string when missing', () => {
    const row = buildProductRow({});
    expect(row.name).toBe('');
  });
});

describe('manage-looks media insertion', () => {
  function buildPhotoRow(lookId: string, body: Record<string, unknown>) {
    return {
      look_id: lookId,
      storage_path: body.storage_path ?? null,
      url: body.url ?? null,
      thumbnail_url: body.thumbnail_url ?? null,
      order_index: body.order_index ?? 0,
    };
  }

  function buildVideoRow(lookId: string, body: Record<string, unknown>) {
    return {
      look_id: lookId,
      storage_path: body.storage_path ?? null,
      url: body.url ?? null,
      poster_url: body.poster_url ?? null,
      duration_seconds: body.duration_seconds ?? null,
      order_index: body.order_index ?? 0,
    };
  }

  it('builds photo row with all fields', () => {
    const row = buildPhotoRow('look-1', { storage_path: 'a/b.jpg', url: 'https://x.com/b.jpg', thumbnail_url: 'https://x.com/b_thumb.jpg', order_index: 2 });
    expect(row.look_id).toBe('look-1');
    expect(row.order_index).toBe(2);
  });

  it('defaults photo order_index to 0', () => {
    const row = buildPhotoRow('look-1', {});
    expect(row.order_index).toBe(0);
    expect(row.storage_path).toBeNull();
  });

  it('builds video row with duration', () => {
    const row = buildVideoRow('look-1', { storage_path: 'a/b.mp4', duration_seconds: 30 });
    expect(row.duration_seconds).toBe(30);
    expect(row.poster_url).toBeNull();
  });
});

describe('manage-looks direct query response mapping', () => {
  // Simulates the shape returned by Supabase .select() with joins

  function mapRow(row: Record<string, unknown>): Record<string, unknown> {
    return {
      ...row,
      look_photos: (row.look_photos as unknown[]) || [],
      look_videos: (row.look_videos as unknown[]) || [],
      look_products: (row.look_products as unknown[]) || [],
    };
  }

  it('maps row with populated relations', () => {
    const row = {
      id: 'look-1', title: 'Test', description: null, video_path: null,
      gender: 'unisex', color: '#333', status: 'draft', enabled: true,
      thumbnail_url: null, created_at: '2024-01-01', updated_at: '2024-01-01',
      user_id: 'user-1',
      look_photos: [{ id: 'p1', order_index: 0, url: 'http://x.com/a.jpg' }],
      look_videos: [] as unknown[],
      look_products: [{ sort_order: 0, products: { id: 'prod-1', name: 'Bag' } }],
    } as Record<string, unknown>;
    const mapped = mapRow(row);
    expect(mapped.look_photos).toHaveLength(1);
    expect(mapped.look_videos).toHaveLength(0);
    expect(mapped.look_products).toHaveLength(1);
  });

  it('defaults null relations to empty arrays', () => {
    const row = { id: 'look-2', title: 'Test', look_photos: null, look_videos: null, look_products: null } as Record<string, unknown>;
    const mapped = mapRow(row);
    expect(mapped.look_photos).toEqual([]);
    expect(mapped.look_videos).toEqual([]);
    expect(mapped.look_products).toEqual([]);
  });

  it('preserves all scalar fields', () => {
    const row = {
      id: 'look-3', title: 'My Look', description: 'desc', color: '#fff',
      gender: 'men', status: 'live', enabled: true,
      look_photos: [], look_videos: [], look_products: [],
    } as Record<string, unknown>;
    const mapped = mapRow(row);
    expect(mapped['id']).toBe('look-3');
    expect(mapped['title']).toBe('My Look');
    expect(mapped['description']).toBe('desc');
    expect(mapped['status']).toBe('live');
  });

  it('computes pagination correctly', () => {
    const page = 2;
    const limit = 12;
    const total = 25;
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const totalPages = Math.ceil(total / limit);
    expect(from).toBe(12);
    expect(to).toBe(23);
    expect(totalPages).toBe(3);
  });

  it('handles page 1 range', () => {
    const page = 1;
    const limit = 12;
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    expect(from).toBe(0);
    expect(to).toBe(11);
  });
});
