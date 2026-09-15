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
  });

  it('still requires /dp/ on Amazon', () => {
    expect(nonProductUrlReason('https://www.amazon.com/Psychology-Money/dp/0857197681')).toBeNull();
    expect(nonProductUrlReason('https://www.amazon.com/gp/help/customer')).not.toBeNull();
  });

  it('isLikelyProductUrl agrees with nonProductUrlReason', () => {
    expect(isLikelyProductUrl('https://www.nordstrom.com/s/x/123')).toBe(true);
    expect(isLikelyProductUrl('https://example.com/')).toBe(false);
  });
});
