import { describe, it, expect } from 'vitest';
import { isShopMyUrl } from './ProfileCrawlsPanel';

describe('isShopMyUrl', () => {
  it('accepts the two ShopMy hosts', () => {
    expect(isShopMyUrl('https://shopmy.us/drconnieyang')).toBe(true);
    expect(isShopMyUrl('https://shop.my/drconnieyang')).toBe(true);
  });

  it('strips a www. prefix', () => {
    expect(isShopMyUrl('https://www.shopmy.us/drconnieyang')).toBe(true);
  });

  it('is case-insensitive on the host', () => {
    expect(isShopMyUrl('https://SHOPMY.US/drconnieyang')).toBe(true);
  });

  it('ignores path and query', () => {
    expect(isShopMyUrl('https://shopmy.us/shop/justbobbidotcom?tab=collections&section_id=409')).toBe(true);
  });

  it('rejects lookalike hosts', () => {
    expect(isShopMyUrl('https://notshopmy.us/drconnieyang')).toBe(false);
    expect(isShopMyUrl('https://shopmy.us.evil.com/drconnieyang')).toBe(false);
    expect(isShopMyUrl('https://evil.com/?x=shopmy.us')).toBe(false);
  });

  it('returns false instead of throwing on a malformed URL', () => {
    expect(isShopMyUrl('not a url')).toBe(false);
  });
});
