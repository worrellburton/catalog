import { describe, it, expect } from 'vitest';
import { shouldRedirectToStyle } from './front-door';

const base = { search: '', isOAuth: false, browseFeed: false };

describe('shouldRedirectToStyle', () => {
  it('redirects a plain open of "/"', () => {
    expect(shouldRedirectToStyle(base)).toBe(true);
  });

  it('stays on the feed mid-OAuth callback', () => {
    expect(shouldRedirectToStyle({ ...base, isOAuth: true })).toBe(false);
    expect(shouldRedirectToStyle({ ...base, search: '?code=abc', isOAuth: true })).toBe(false);
  });

  it('stays on the feed for deep-links and marketing entries', () => {
    for (const search of ['?look=uuid', '?q=black+shoes', '?ref=lena', '?flow=1']) {
      expect(shouldRedirectToStyle({ ...base, search })).toBe(false);
    }
  });

  it('stays on the feed when browsing is requested', () => {
    expect(shouldRedirectToStyle({ ...base, search: '?feed=1' })).toBe(false);
    expect(shouldRedirectToStyle({ ...base, browseFeed: true })).toBe(false);
  });
});
