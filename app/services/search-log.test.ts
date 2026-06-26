import { describe, it, expect, vi } from 'vitest';
import { logSearch, markSearchClicked } from './search-log';

// Search rows flush through supabase.functions.invoke. Mock the module by its
// resolved path so search-log's aliased `~/utils/supabase` import hits the same
// mock; capture the flushed batch to assert the computed `clicked` field. The
// shared array comes from vi.hoisted so the hoisted factory can close over it.
const { flushed } = vi.hoisted(() => ({ flushed: [] as Array<Record<string, unknown>> }));
vi.mock('../utils/supabase', () => ({
  supabase: {
    functions: {
      invoke: async (_name: string, opts: { body: { entries: Array<Record<string, unknown>> } }) => {
        flushed.push(...opts.body.entries);
        return { data: null, error: null };
      },
    },
  },
}));

// In node there's no window, so the 5 s timer never arms — the only flush
// trigger is FLUSH_AT_SIZE (16). Push unique, mutually non-prefix fillers
// under a throwaway handle so they never dedup against the test's own row.
let fillerN = 0;
function forceFlush(): Promise<void> {
  for (let i = 0; i < 16; i++) logSearch({ query: `filler-${fillerN++}-x`, user_handle: '__filler__', results_count: 1, clicked: false, filter: 'all' });
  return vi.waitFor(() => expect(flushed.length).toBeGreaterThan(0));
}
const row = (query: string) => flushed.find(e => e.query === query);

describe('search-log click marking', () => {
  it('flips a row whose click landed while it was still queued', async () => {
    logSearch({ query: 'red dress', user_handle: 'u1', results_count: 5, clicked: false, filter: 'all' });
    markSearchClicked('red dress', 'u1');
    await forceFlush();
    expect(row('red dress')?.clicked).toBe(true);
  });

  it('seeds clicked when the click happened before the debounced log fired', async () => {
    markSearchClicked('green coat', 'u2'); // click first
    logSearch({ query: 'green coat', user_handle: 'u2', results_count: 3, clicked: false, filter: 'all' }); // log after
    await forceFlush();
    expect(row('green coat')?.clicked).toBe(true);
  });

  it('carries a click forward when a refinement supersedes the shorter query', async () => {
    logSearch({ query: 'shoe', user_handle: 'u3', results_count: 2, clicked: false, filter: 'all' });
    markSearchClicked('shoe', 'u3');
    logSearch({ query: 'shoes', user_handle: 'u3', results_count: 4, clicked: false, filter: 'all' }); // forward swap
    await forceFlush();
    expect(row('shoe')).toBeUndefined();      // collapsed away
    expect(row('shoes')?.clicked).toBe(true); // click survived
  });

  it('leaves an unclicked search as clicked:false', async () => {
    logSearch({ query: 'blue hat', user_handle: 'u4', results_count: 1, clicked: false, filter: 'all' });
    await forceFlush();
    expect(row('blue hat')?.clicked).toBe(false);
  });
});
