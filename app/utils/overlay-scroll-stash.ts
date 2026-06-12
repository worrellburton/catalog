// Overlay scroll restore — back returns you to WHERE you left the page,
// not its top (founder's call: re-entering a look/product at the top is
// disorienting).
//
// Overlays continuously record their scroller position here (keyed by
// their URL slug). When a navigation that should RESTORE (browser back /
// the state-driven look-restore on product close) re-opens an overlay,
// the opener marks the slug; the overlay consumes the mark on mount and
// jumps to the recorded offset. Fresh opens never consume — no mark, no
// jump.

const positions = new Map<string, number>();
const returns = new Set<string>();

/** Overlays call this from a passive scroll listener (rAF-throttled). */
export function recordOverlayScroll(key: string | null | undefined, top: number): void {
  if (key) positions.set(key, top);
}

/** Openers call this when the open IS a return (back / restore). */
export function markOverlayReturn(key: string | null | undefined): void {
  if (key) returns.add(key);
}

/** Mounting overlays call this once; returns the offset only when the
 *  open was marked as a return, and clears the mark either way. */
export function consumeReturnScroll(key: string | null | undefined): number | null {
  if (!key || !returns.has(key)) return null;
  returns.delete(key);
  return positions.get(key) ?? null;
}
