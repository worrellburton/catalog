/**
 * shouldBeVideo — pure deterministic split between "play as video"
 * and "show as still" for the catalog feed, driven by the Video →
 * Still image ratio dial in /admin/dials.
 *
 *   ratio = 100  → always video    (current behaviour)
 *   ratio = 0    → always still
 *   ratio = N    → ~N% of cards play video, the rest show stills
 *
 * The split is keyed on the card's stable identifier so the SAME
 * card lands on the SAME side across renders / refreshes / sessions.
 * Without that, every re-render of LookCard would re-roll the dice
 * and the feed would flicker.
 */

// djb2 hash → unsigned int. Cheap, deterministic, collision-tolerant
// for our purposes (we just need a uniform-enough distribution mod
// 100 — we don't care about hash quality beyond that).
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Decide whether the given card should render as video (true) or
 * still image (false) at the current ratio. Stable per cardId.
 *
 * Notes on the edge cases:
 *   - ratio ≥ 100  → always video (avoids a `100 < 100` corner)
 *   - ratio ≤ 0    → always still
 *   - cardId       → number or string both fine; non-strings get
 *                    coerced via String() first
 */
export function shouldBeVideo(cardId: string | number, ratio: number): boolean {
  if (ratio >= 100) return true;
  if (ratio <= 0)   return false;
  const bucket = hashString(String(cardId)) % 100;
  return bucket < ratio;
}
