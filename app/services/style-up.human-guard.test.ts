import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sendStylistText, sendChooser, sendProductPick, sendSwapOptions } from './style-up';

// The rule-based client stylist must stay silent in a HUMAN stylist's thread —
// a real person answers those from the inbox. But the human's OWN inbox posts
// products through sendProductPick, so their own writes must still land. The
// guard lives inside the four writers, so this covers every caller. Mock the
// supabase module by its resolved path (same trick as search-log.test.ts) so
// style-up's aliased `~/utils/supabase` import hits the stub; `state` comes from
// vi.hoisted so the hoisted mock factory can close over it.
const { state } = vi.hoisted(() => ({
  state: {
    isHuman: false,
    stylistUserId: 'stylist-user' as string | null,
    signedInUserId: 'shopper-user' as string | null,
    inserts: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock('../utils/supabase', () => {
  interface Builder {
    select(cols?: string): Builder;
    eq(col: string, val: unknown): Builder;
    update(row: Record<string, unknown>): Builder;
    insert(row: Record<string, unknown>): Builder;
    maybeSingle(): Promise<{ data: unknown; error: null }>;
    single(): Promise<{ data: unknown; error: null }>;
    then(resolve: (v: { data: null; error: null }) => unknown): Promise<unknown>;
  }
  const build = (table: string, row?: Record<string, unknown>): Builder => {
    const b: Builder = {
      select: () => b,
      eq: () => b,
      update: () => b,
      insert: (r) => {
        if (table === 'style_up_messages') state.inserts.push(r);
        return build(table, r);
      },
      // The only maybeSingle() in play is the guard's thread → stylist lookup.
      maybeSingle: async () => ({
        data: { stylist: { is_human: state.isHuman, human_user_id: state.stylistUserId } },
        error: null,
      }),
      single: async () => ({
        data: {
          id: 'msg-1', thread_id: row?.thread_id, sender: 'stylist', kind: row?.kind ?? 'text',
          body: row?.body ?? null, product_ref: row?.product_ref ?? null,
          render_generation_id: null, quick_replies: null, created_at: '2026-01-01T00:00:00Z',
        },
        error: null,
      }),
      then: (resolve) => Promise.resolve({ data: null, error: null }).then(resolve),
    };
    return b;
  };
  return {
    supabase: {
      from: (table: string) => build(table),
      auth: {
        getUser: async () => ({
          data: { user: state.signedInUserId ? { id: state.signedInUserId } : null },
          error: null,
        }),
      },
    },
  };
});

const CHOOSE = { kind: 'slots', prompt: 'Build your outfit', options: [{ value: 'Top', label: 'Top' }] };
const PRODUCT = { id: 'p1', name: 'Oxford shirt' };

/** Every writer that posts as the stylist, run against one thread. */
async function runAllWriters(threadId: string) {
  return [
    await sendStylistText(threadId, 'Love it, putting your full look together now'),
    await sendChooser(threadId, CHOOSE),
    await sendProductPick(threadId, PRODUCT),
    await sendSwapOptions(threadId, 'Pants', 'pants', [PRODUCT]),
  ];
}

beforeEach(() => { state.inserts = []; });

// Fresh thread id per case: the guard memoises its verdict per thread.
describe('style-up stylist writers — human-stylist guard', () => {
  it('writes nothing into a human stylist thread', async () => {
    state.isHuman = true;
    state.signedInUserId = 'shopper-user';
    const results = await runAllWriters('thread-human');
    expect(results).toEqual([null, null, null, null]);
    expect(state.inserts).toHaveLength(0);
  });

  it('still writes into an AI stylist thread', async () => {
    state.isHuman = false;
    state.signedInUserId = 'shopper-user';
    const results = await runAllWriters('thread-ai');
    expect(results.every(r => r !== null)).toBe(true);
    expect(state.inserts).toHaveLength(4);
    expect(state.inserts.every(r => r.sender === 'stylist')).toBe(true);
  });

  // routes/style_.inbox.tsx attaches products via sendProductPick — the thread
  // is human by definition there, so suppressing it would kill that button.
  it('lets the human stylist write into their own thread', async () => {
    state.isHuman = true;
    state.signedInUserId = 'stylist-user';
    const msg = await sendProductPick('thread-own-inbox', PRODUCT);
    expect(msg).not.toBeNull();
    expect(state.inserts).toHaveLength(1);
  });
});
