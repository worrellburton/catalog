import { describe, it, expect } from 'vitest';
// Cross-boundary import, same as style-retrieval-rotate.test.ts: the edge helper
// is pure TS with no Deno imports, so it is testable from the app's vitest run.
import { retrieveOccasionCandidates } from '../../supabase/functions/_shared/style-retrieval';

/** A style_slot_search row as the RPC returns it. */
const row = (id: string, score = 1) => ({
  product_id: id, product_name: `Item ${id}`, product_brand: 'B', product_price: '10',
  product_image_url: 'http://img', product_url: 'http://u', product_type: 'shirt',
  product_gender: 'unisex', score,
});

/**
 * Records every rpc call and replays a scripted queue of responses per slot.
 *
 * retrieveOccasionCandidates queries every gender slot CONCURRENTLY
 * (Promise.all — this is real, load-bearing production behaviour: each
 * slot is an independent RPC round-trip). A single shared call counter
 * across all 5 concurrently-interleaved slots can't reproduce "this ONE
 * slot fell through tier 1 -> 2 -> 3" deterministically — other slots'
 * calls consume script entries out of order. So the queue is keyed per
 * slot instead, using the trailing noun of p_query (SLOT_NOUN — 'shirt',
 * 'pants', 'shoes', 'jacket', 'hat' — always the last token and unique
 * per slot), giving each slot its own independent, deterministic cursor
 * — exactly what a real backend gives each slot's own retry sequence.
 */
function stubClient(script: Array<{ data: unknown; error: unknown }>) {
  const calls: Array<Record<string, unknown>> = [];
  const cursor = new Map<string, number>();
  return {
    calls,
    rpc(_fn: string, args: Record<string, unknown>) {
      calls.push(args);
      const slotKey = String(args.p_query ?? '').trim().split(/\s+/).pop() ?? '';
      const i = cursor.get(slotKey) ?? 0;
      cursor.set(slotKey, i + 1);
      return Promise.resolve(script[Math.min(i, script.length - 1)]);
    },
  };
}

// One slot only, so the call script is unambiguous: a male shopper drops
// 'dresses', so restrict further by asking for a single slot via kPerSlot and
// reading only the 'tops' diagnostic out of the result.
const OPTS = { occasion: 'rooftop dinner', gender: 'male' as const, aesthetic: 'smart casual' };

describe('retrieveOccasionCandidates — recorded fallback tier', () => {
  it('records tier 1 when the aesthetic query returns rows', async () => {
    const c = stubClient([{ data: [row('a'), row('b')], error: null }]);
    const { slots, cands } = await retrieveOccasionCandidates(c, OPTS);
    const tops = slots.find(s => s.slot === 'tops')!;
    expect(tops.tier).toBe(1);
    expect(tops.query).toContain('smart casual');
    expect(tops.returned).toBe(2);
    expect(cands.every(x => typeof x.rank === 'number')).toBe(true);
  });

  it('records tier 2 when the aesthetic query is empty and occasion-only works', async () => {
    const c = stubClient([
      { data: [], error: null },              // tier 1 — aesthetic + occasion
      { data: [row('a')], error: null },      // tier 2 — occasion only
    ]);
    const { slots } = await retrieveOccasionCandidates(c, OPTS);
    const tops = slots.find(s => s.slot === 'tops')!;
    expect(tops.tier).toBe(2);
    expect(tops.query).not.toContain('smart casual');
  });

  it('records tier 3 when excluding shown ids emptied the slot', async () => {
    const c = stubClient([
      { data: [], error: null },              // tier 1
      { data: [], error: null },              // tier 2
      { data: [row('a')], error: null },      // tier 3 — exclude list dropped
    ]);
    const { slots } = await retrieveOccasionCandidates(c, { ...OPTS, excludeIds: ['x'], rotate: 1 });
    const tops = slots.find(s => s.slot === 'tops')!;
    expect(tops.tier).toBe(3);
    expect(tops.kept).toBe(1);
  });

  it('records the error and keeps nothing when every tier fails', async () => {
    const c = stubClient([{ data: null, error: { message: 'boom' } }]);
    const { slots, cands } = await retrieveOccasionCandidates(c, OPTS);
    const tops = slots.find(s => s.slot === 'tops')!;
    expect(tops.kept).toBe(0);
    expect(tops.error).toBe('boom');
    expect(cands).toHaveLength(0);
  });

  it('ranks candidates from 0 within their own slot', async () => {
    const c = stubClient([{ data: [row('a', 9), row('b', 5), row('c', 1)], error: null }]);
    const { cands } = await retrieveOccasionCandidates(c, OPTS);
    const tops = cands.filter(x => x.slot === 'tops');
    expect(tops.map(x => x.rank)).toEqual([0, 1, 2]);
  });
});
