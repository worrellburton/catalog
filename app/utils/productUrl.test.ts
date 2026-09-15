import { describe, it, expect } from 'vitest';
import { nonProductUrlReason, isLikelyProductUrl } from './productUrl';

describe('nonProductUrlReason', () => {
  it('accepts Nordstrom and Nordstrom Rack /s/ product pages', () => {
    expect(nonProductUrlReason('https://www.nordstrom.com/s/vince-fulton-low-top-sneaker-men/9144596')).toBeNull();
    expect(nonProductUrlReason('https://www.nordstromrack.com/s/allsaints-klip-sneaker-men/7942006')).toBeNull();
  });

  it('still rejects Amazon search paths', () => {
    expect(nonProductUrlReason('https://www.amazon.com/s?k=running+shoes')).not.toBeNull();
    expect(nonProductUrlReason('https://www.amazon.com/s/ref=nb_sb_noss')).not.toBeNull();
  });

  it('still rejects generic non-product paths', () => {
    expect(nonProductUrlReason('https://example.com/search')).not.toBeNull();
    expect(nonProductUrlReason('https://example.com/')).toBe('site homepage');
    expect(nonProductUrlReason('https://example.com/cart')).not.toBeNull();
    expect(nonProductUrlReason('https://example.com/cart/items')).not.toBeNull();
  });

  it('matches bad prefixes on a path boundary, not as a substring', () => {
    // Real product slugs that merely start with a bad prefix must pass.
    expect(nonProductUrlReason('https://example.com/cartier-tank-watch-p12345')).toBeNull();
    expect(nonProductUrlReason('https://example.com/about-face-blush-palette')).toBeNull();
    expect(nonProductUrlReason('https://example.com/contactless-card-case')).toBeNull();
    expect(nonProductUrlReason('https://example.com/newsboy-cap')).toBeNull();
    expect(nonProductUrlReason('https://example.com/blogger-jeans')).toBeNull();
    expect(nonProductUrlReason('https://example.com/accountancy-branded-tee')).toBeNull();
  });

  it('still requires /dp/ on Amazon', () => {
    expect(nonProductUrlReason('https://www.amazon.com/Psychology-Money/dp/0857197681')).toBeNull();
    expect(nonProductUrlReason('https://www.amazon.com/gp/help/customer')).not.toBeNull();
  });

  it('rejects /customer subpaths but not slugs that merely start with it', () => {
    expect(nonProductUrlReason('https://example.com/customer')).not.toBeNull();
    expect(nonProductUrlReason('https://example.com/customer/')).not.toBeNull();
    expect(nonProductUrlReason('https://example.com/customer/orders')).not.toBeNull();
    expect(nonProductUrlReason('https://example.com/customer/profile')).not.toBeNull();
    expect(nonProductUrlReason('https://example.com/customer-favourites-tee')).toBeNull();
  });

  it('isLikelyProductUrl agrees with nonProductUrlReason', () => {
    expect(isLikelyProductUrl('https://www.nordstrom.com/s/x/123')).toBe(true);
    expect(isLikelyProductUrl('https://example.com/')).toBe(false);
  });
});
