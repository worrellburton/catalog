import { describe, it, expect } from 'vitest';
// Cross-boundary import: the edge helper is pure TS (no Deno/esm imports), so the
// rotation math is unit-testable from the app's vitest run.
import { rotateWithAnchors } from '../../supabase/functions/_shared/style-retrieval';

describe('rotateWithAnchors (Stylist Engine pool rotation)', () => {
  const rows = [0, 1, 2, 3, 4, 5]; // ranked list; index 0-1 are the anchors

  it('rotate=0 is a no-op, trimmed to out (un-rotated first turn)', () => {
    expect(rotateWithAnchors(rows, 0, 4)).toEqual([0, 1, 2, 3]);
  });

  it('keeps the top-2 anchors pinned and cycles the tail forward', () => {
    // tail = [2,3,4,5]; off = 1 → [3,4,5,2]; head + tail = [0,1,3,4,5,2] → trim 4
    expect(rotateWithAnchors(rows, 1, 4)).toEqual([0, 1, 3, 4]);
    // anchors unchanged, index 2 differs from the rotate=0 case
    expect(rotateWithAnchors(rows, 1, 4).slice(0, 2)).toEqual([0, 1]);
    expect(rotateWithAnchors(rows, 1, 4)[2]).not.toBe(rotateWithAnchors(rows, 0, 4)[2]);
  });

  it('rotating by the tail length returns the original order (full cycle)', () => {
    expect(rotateWithAnchors(rows, 4, 6)).toEqual(rows); // tail length is 4
  });

  it('is a no-op when there is nothing past the anchors to rotate', () => {
    expect(rotateWithAnchors([9, 8], 3, 8)).toEqual([9, 8]);
  });
});
