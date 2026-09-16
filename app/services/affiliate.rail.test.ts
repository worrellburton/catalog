import { describe, it, expect } from 'vitest';
import { pickRail } from './affiliate';

describe('pickRail', () => {
  it('returns the creator ShopMy link untouched, ahead of every other rail', () => {
    const r = pickRail('https://us.etoile.com/products/vanity-case', {
      id: 'p1',
      affiliate_url: 'https://go.shopmy.us/p-51354524',
    });
    expect(r.link).toBe('https://go.shopmy.us/p-51354524');
    expect(r.rail).toBe('shopmy');
    expect(r.wrappable).toBe(false);
  });

  it('prefers the creator link over a direct tracked link for the same product', () => {
    const r = pickRail(
      'https://us.etoile.com/products/vanity-case',
      { id: 'p1', affiliate_url: 'https://go.shopmy.us/p-51354524' },
      'https://tracked.example/p1',
    );
    expect(r.link).toBe('https://go.shopmy.us/p-51354524');
    expect(r.rail).toBe('shopmy');
  });

  it('falls through to the direct tracked link when there is no creator link', () => {
    const r = pickRail('https://us.etoile.com/x', { id: 'p1' }, 'https://tracked.example/p1');
    expect(r.link).toBe('https://tracked.example/p1');
    expect(r.rail).toBe('affiliate.com');
    expect(r.wrappable).toBe(false);
  });

  it('falls through to the Shopnomix wrap for an ordinary merchant', () => {
    const r = pickRail('https://revolve.com/some-dress', { id: 'p1' });
    expect(r.link).toBeNull();
    expect(r.rail).toBe('shopnomix');
    expect(r.wrappable).toBe(true);
  });

  it('stays direct for an excluded host', () => {
    // Shopnomix runs every brand except Amazon and Booking.
    const r = pickRail('https://www.amazon.com/dp/B000', { id: 'p1' });
    expect(r.link).toBeNull();
    expect(r.rail).toBe('direct');
    expect(r.wrappable).toBe(false);
  });

  it('is unaffected by a product with no affiliate_url field at all', () => {
    expect(pickRail('https://revolve.com/x', { id: 'p1' }).rail).toBe('shopnomix');
    expect(pickRail('https://revolve.com/x', null).rail).toBe('shopnomix');
  });
});
