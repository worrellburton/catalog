// Home hero scroll progress (0 → 1 across the first half-screen of scroll).
//
// Written from the home scroll handler once per frame. It used to be set as
// a custom property on <html>: an inherited custom property changed on the
// root invalidates computed style for the ENTIRE subtree — every mounted
// feed card — on every scrolled frame in the hero band. Only three elements
// read it, so it is written on those directly (a scoped invalidation), and
// skipped entirely when the value hasn't changed (it clamps at 1 for the
// rest of the scroll).

const CONSUMER_SELECTOR = '.sfh-stage, .bottom-bar, .home-recent-strip';
const PROP = '--hero-scroll-progress';

let last = -1;

/** Apply a 0..1 progress value to the elements whose CSS reads it. Pass
 *  `force` when the consumers may have (re)mounted since the last write,
 *  so an unchanged value is still re-applied. */
export function setHeroScrollProgress(ratio: number, force = false): void {
  if (typeof document === 'undefined') return;
  if (!force && ratio === last) return;
  last = ratio;
  const value = String(ratio);
  document.querySelectorAll<HTMLElement>(CONSUMER_SELECTOR).forEach(el => {
    el.style.setProperty(PROP, value);
  });
}
