// Whatever friendlyRenderStartError returns is spoken by the stylist in chat
// ("Couldn't render that, <this>"), so the one thing these cases really pin is
// that raw Postgres text can never be what the shopper reads.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { friendlyRenderStartError } from './style-up';

const FK_ERROR =
  'insert or update on table "user_generation_products" violates foreign key '
  + 'constraint "user_generation_products_product_id_fkey"';

describe('friendlyRenderStartError', () => {
  beforeEach(() => {
    // mockClear too: spyOn returns the SAME spy on re-spy, so call history from
    // earlier cases would otherwise carry into the "does not log" assertion.
    vi.spyOn(console, 'warn').mockImplementation(() => {}).mockClear();
  });

  it('never leaks the raw database text', () => {
    for (const raw of [FK_ERROR, 'duplicate key value violates unique constraint "x_pkey"', 'TypeError: failed to fetch', 'some unmapped pg error', null]) {
      const out = friendlyRenderStartError(raw);
      expect(out).not.toMatch(/insert or update|constraint|violates|_fkey|_pkey|TypeError/i);
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it('names the real cause for a non-catalog piece instead of quoting the FK', () => {
    expect(friendlyRenderStartError(FK_ERROR)).toContain('catalog');
  });

  it('tells the shopper a piece is already in the look on a duplicate key', () => {
    expect(friendlyRenderStartError('duplicate key value violates unique constraint')).toContain('already has');
  });

  it('falls back to a retry line for an unmapped error', () => {
    expect(friendlyRenderStartError('something nobody mapped')).toContain('another go');
  });

  it('reads as a fragment after "Couldn\'t render that, "', () => {
    // Lowercase start, so the sentence the caller builds is not mid-sentence capped.
    const out = friendlyRenderStartError(FK_ERROR);
    expect(out[0]).toBe(out[0].toLowerCase());
  });

  it('still logs the raw error for debugging', () => {
    friendlyRenderStartError(FK_ERROR);
    expect(console.warn).toHaveBeenCalledWith('[style-up] render failed to start:', FK_ERROR);
  });

  it('does not log when there is nothing to log', () => {
    friendlyRenderStartError(null);
    expect(console.warn).not.toHaveBeenCalled();
  });
});
