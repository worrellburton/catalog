// Global mobile gesture: EDGE-swipe LEFT on any page → open the
// Account menu. The touch must START within EDGE_PX of the right edge
// of the viewport (iOS-style edge gesture) and then drag left. This
// is the only way to avoid conflicting with inner horizontal content
// — carousels, story rails, the Try-It-On product picker, etc. all
// own their own left/right drags and used to trigger the menu by
// accident.
//
// Skip rules (still applied on top of the edge gate):
//   • Desktop: gesture is disabled (matchMedia max-width 768px).
//   • Flutter shell: native chrome owns horizontal gestures.
//   • Input focus: never recognise mid-typing.
//   • Touch starts inside a horizontally-scrollable container (kept
//     for the rare case where a scroller starts within EDGE_PX of the
//     right edge).
//   • [data-no-swipe-menu] opt-out hook on a parent root.
//   • Vertical-dominant swipes: the user is scrolling.
//
// Threshold tuning:
//   • Touch START within 28px of the viewport right edge.
//   • ≥70px leftward drag, ≤ 0.5 × |dx| vertical drift, within 500ms.

import { useEffect } from 'react';

const EDGE_PX = 28;
const MIN_HORIZONTAL_PX = 70;
const MAX_DURATION_MS = 500;
const MAX_VERTICAL_RATIO = 0.5;

function hasHorizontalScrollAncestor(el: EventTarget | null): boolean {
  let node = el as HTMLElement | null;
  while (node && node !== document.body) {
    if (node.nodeType !== 1) { node = node.parentElement; continue; }
    // Explicit opt-out for components that own their own swipes
    // (LookOverlay's sheet drag, ProductPage's swipe-down close, etc.).
    if (node.hasAttribute('data-no-swipe-menu')) return true;
    const cs = window.getComputedStyle(node);
    const oxScrolls = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
    if (oxScrolls && node.scrollWidth > node.clientWidth) return true;
    node = node.parentElement;
  }
  return false;
}

function focusInInput(): boolean {
  const a = document.activeElement as HTMLElement | null;
  if (!a) return false;
  const t = a.tagName;
  if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return true;
  if (a.isContentEditable) return true;
  return false;
}

export default function SwipeMenuGesture() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Desktop short-circuit. matchMedia stays subscribed so the listener
    // attaches if the viewport rotates / resizes into mobile range.
    const mql = window.matchMedia('(max-width: 768px)');
    let attached = false;

    let startX = 0;
    let startY = 0;
    let startT = 0;
    let active = false;

    const onTouchStart = (e: TouchEvent) => {
      // Single-finger only; multi-finger is a pinch / different gesture.
      if (e.touches.length !== 1) { active = false; return; }
      if (focusInInput()) return;
      if (typeof document !== 'undefined' && document.documentElement.dataset.shell === 'catalog-app') return;
      const t = e.touches[0];
      // EDGE gate: only arm the gesture when the touch lands in the
      // rightmost EDGE_PX strip. Inner horizontal carousels start far
      // from the edge so they're naturally exempt — no per-component
      // opt-outs needed in the common case.
      if (t.clientX < window.innerWidth - EDGE_PX) return;
      // Belt-and-suspenders: a horizontal scroller that happens to sit
      // right at the edge still wins.
      if (hasHorizontalScrollAncestor(e.target)) return;
      startX = t.clientX;
      startY = t.clientY;
      startT = performance.now();
      active = true;
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!active) return;
      active = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const dt = performance.now() - startT;
      // Negative dx == finger moved left == "swipe left to reveal menu".
      if (dx > -MIN_HORIZONTAL_PX) return;
      if (Math.abs(dy) > Math.abs(dx) * MAX_VERTICAL_RATIO) return;
      if (dt > MAX_DURATION_MS) return;
      window.dispatchEvent(new CustomEvent('catalog:open-account-menu'));
    };

    const attach = () => {
      if (attached) return;
      attached = true;
      window.addEventListener('touchstart', onTouchStart, { passive: true });
      window.addEventListener('touchend', onTouchEnd, { passive: true });
    };
    const detach = () => {
      if (!attached) return;
      attached = false;
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
    };

    if (mql.matches) attach();
    const onChange = (ev: MediaQueryListEvent) => { if (ev.matches) attach(); else detach(); };
    mql.addEventListener?.('change', onChange);
    return () => {
      detach();
      mql.removeEventListener?.('change', onChange);
    };
  }, []);
  return null;
}
