// Drives the CreatorConstellation panel's vertical position. The panel is the
// "viewport above" the home feed; pulling down at the top scrolls it into
// view and it snaps open/closed on release. The live pull (0 = parked above,
// 1 = filling the viewport) is written to a CSS custom property on <html> so
// the per-frame finger tracking never triggers a React render.
//
//   --people-pull : 0..1, the panel's reveal amount
//   html.people-peeking : finger is dragging — no transition (1:1 tracking)
//   html.people-snapping : released — CSS transition eases to the snap point
//   html.people-open : the panel is committed open (interactive)

export function setPeoplePull(p: number) {
  if (typeof document === 'undefined') return;
  const r = document.documentElement;
  r.classList.add('people-peeking');
  r.classList.remove('people-snapping');
  r.style.setProperty('--people-pull', String(Math.max(0, Math.min(1, p))));
}

export function snapPeople(open: boolean) {
  if (typeof document === 'undefined') return;
  const r = document.documentElement;
  r.classList.remove('people-peeking');
  r.classList.add('people-snapping');
  r.classList.toggle('people-open', open);
  r.style.setProperty('--people-pull', open ? '1' : '0');
}
