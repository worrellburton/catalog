import { describe, it, expect } from 'vitest';
import { weaveByFeedRank } from './feed-weave';

interface Item { id: string; kind: 'look' | 'product'; rank: number | null }
const look = (id: string, rank: number | null = null): Item => ({ id, kind: 'look', rank });
const prod = (id: string, rank: number | null = null): Item => ({ id, kind: 'product', rank });

const weave = (looks: Item[], products: Item[]) =>
  weaveByFeedRank(looks, products, i => i.rank, i => i.kind === 'look').map(i => i.id);

describe('weaveByFeedRank', () => {
  it('orders by feed_rank ascending across both types', () => {
    expect(weave([look('L', 2)], [prod('P', 1), prod('Q', 3)])).toEqual(['P', 'L', 'Q']);
  });

  it('sends unranked (null) items to the back, looks before products there', () => {
    // ranked P(0) leads; then the unranked group: looks first, then products.
    expect(weave([look('L1'), look('L2')], [prod('P', 0), prod('U1'), prod('U2')]))
      .toEqual(['P', 'L1', 'L2', 'U1', 'U2']);
  });

  it('keeps input order among items that tie (stable)', () => {
    expect(weave([], [prod('a'), prod('b'), prod('c')])).toEqual(['a', 'b', 'c']);
  });

  it('pulls a look to index 1 when none lands in the first `frontLook` cells', () => {
    // Four ranked products lead (0..3); the look is unranked → would land 5th.
    const out = weave([look('L')], [prod('p0', 0), prod('p1', 1), prod('p2', 2), prod('p3', 3)]);
    expect(out).toEqual(['p0', 'L', 'p1', 'p2', 'p3']);
  });

  it('leaves a look already near the front in place', () => {
    const out = weave([look('L', 1)], [prod('p0', 0), prod('p2', 2)]);
    expect(out).toEqual(['p0', 'L', 'p2']);
  });
});
