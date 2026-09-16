import { describe, it, expect } from 'vitest';
import { mapCreatorProductRows, type CreatorProductRow } from './creator-products';

const row = (over: Partial<CreatorProductRow['products']> & { id: string }, affiliate_url: string | null, sort_order = 0): CreatorProductRow => ({
  affiliate_url,
  sort_order,
  products: {
    id: over.id, name: 'Vanity Case', brand: 'ETOILE', price: '$100.00',
    image_url: 'https://static.shopmy.us/pins/a.png',
    primary_image_url: null, primary_video_url: null, primary_hls_url: null,
    primary_video_poster_url: null, url: 'https://us.etoile.com/products/vanity-case',
    images: null, ...over,
  },
});

describe('mapCreatorProductRows', () => {
  it('carries the creator ShopMy link onto the product', () => {
    const [p] = mapCreatorProductRows([row({ id: 'p1' }, 'https://go.shopmy.us/p-51354524')]);
    // This is the whole point: Rail 0 reads Product.affiliate_url.
    expect(p.affiliate_url).toBe('https://go.shopmy.us/p-51354524');
    expect(p.id).toBe('p1');
    expect(p.brand).toBe('ETOILE');
  });

  it('leaves affiliate_url undefined when the link row has none', () => {
    const [p] = mapCreatorProductRows([row({ id: 'p1' }, null)]);
    expect(p.affiliate_url).toBeUndefined();
  });

  it('drops a link row whose product was deleted', () => {
    // creator_products cascades on product delete, but a stale embedded null
    // still arrives from PostgREST on a partially-visible join.
    expect(mapCreatorProductRows([{ affiliate_url: 'x', sort_order: 0, products: null }])).toEqual([]);
  });

  it('preserves sort_order', () => {
    const out = mapCreatorProductRows([
      row({ id: 'b' }, null, 2),
      row({ id: 'a' }, null, 1),
    ]);
    expect(out.map(p => p.id)).toEqual(['a', 'b']);
  });

  it('prefers primary_image_url, then image_url, then images[0]', () => {
    expect(mapCreatorProductRows([row({ id: 'p1', primary_image_url: 'PRI' }, null)])[0].image).toBe('PRI');
    expect(mapCreatorProductRows([row({ id: 'p1', primary_image_url: null }, null)])[0].image)
      .toBe('https://static.shopmy.us/pins/a.png');
    expect(mapCreatorProductRows([row({ id: 'p1', primary_image_url: null, image_url: null, images: ['ARR'] }, null)])[0].image)
      .toBe('ARR');
  });
});
