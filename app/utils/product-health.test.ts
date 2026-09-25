import { describe, it, expect } from 'vitest';
import { linkStateFor, mediaCompletion, productHealth } from './product-health';

const complete = {
  name: 'Strato Tech Tee', brand: 'Vuori', price: '$58', url: 'https://vuori.com/p/1',
  primaryImageUrl: 'https://x/a.jpg', primaryImagePolished: true,
  posterUrl: 'https://x/p.jpg', videoUrl: 'https://x/v.mp4', urlStatus: 200,
};

describe('linkStateFor', () => {
  it('maps statuses and sentinels', () => {
    expect(linkStateFor('https://a', 200)).toBe('live');
    expect(linkStateFor('https://a', 206)).toBe('live');
    expect(linkStateFor('https://a', 416)).toBe('live');
    expect(linkStateFor('https://a', 404)).toBe('dead');
    expect(linkStateFor('https://a', 500)).toBe('dead');
    expect(linkStateFor('https://a', -3)).toBe('redirected');
    expect(linkStateFor('https://a', 403)).toBe('blocked');
    expect(linkStateFor('https://a', -2)).toBe('unreachable');
    expect(linkStateFor('https://a', -1)).toBe('policy');
    expect(linkStateFor('https://a', null)).toBe('unchecked');
    expect(linkStateFor('', 200)).toBe('missing');
  });
});

describe('mediaCompletion', () => {
  it('needs a polished primary, a poster and a video', () => {
    expect(mediaCompletion(complete).level).toBe('ok');
    expect(mediaCompletion({ ...complete, primaryImagePolished: false }).done).toBe(2);
    expect(mediaCompletion({ ...complete, primaryImageUrl: null }).polished).toBe(false);
    expect(mediaCompletion({ primaryImageUrl: null, primaryImagePolished: false, posterUrl: null, videoUrl: null }).level).toBe('fail');
  });
});

describe('productHealth', () => {
  it('is fully healthy when every check passes', () => {
    const h = productHealth(complete);
    expect(h.level).toBe('ok');
    expect(h.score).toBe(100);
  });
  it('warns on partial media or a bot-blocked link, fails on a dead link', () => {
    expect(productHealth({ ...complete, videoUrl: null }).level).toBe('warn');
    expect(productHealth({ ...complete, urlStatus: 403 }).level).toBe('warn');
    expect(productHealth({ ...complete, urlStatus: 404 }).level).toBe('fail');
  });
  it('fails a missing price or placeholder brand', () => {
    expect(productHealth({ ...complete, price: ' - ' }).level).toBe('fail');
    expect(productHealth({ ...complete, brand: 'Unknown' }).checks.find(c => c.key === 'identity')?.level).toBe('fail');
  });
  it('orders scores from healthiest to worst', () => {
    const a = productHealth(complete).score;
    const b = productHealth({ ...complete, urlStatus: 403 }).score;
    const c = productHealth({ ...complete, urlStatus: 404, price: '' }).score;
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });
});
