// Global mobile gesture: swipe LEFT on any page → open the Account menu.
//
// Mounts once at the app root and listens to touchstart / touchmove /
// touchend on `window`. When a recognised left-swipe completes, we
// dispatch `catalog:open-account-menu` on the window — UserMenu listens
// for it and opens its mobile page surface.
//
// Skip rules (so the gesture doesn't fight legit content):
//   • Desktop: gesture is disabled (matchMedia max-width 768px).
//   • Flutter shell: native chrome owns horizontal gestures.
//   • Input focus: never recognise mid-typing.
//   • Touch starts inside a horizontally-scrollable container (stories
//     rail, trail rail, anything with overflow-x:auto and >0 scroll
//     width): native horizontal scroll wins.
//   • Touch starts inside a known overlay that owns its own swipe
//     gestures (LookOverlay sheet drag, ProductPage swipe-down dismiss):
//     skip via [data-no-swipe-menu] hook on those roots.
//   • Vertical-dominant swipes: the user is scrolling the page, not
//     swiping horizontally.
//
// Threshold tuning: 70px horizontal deltaX, ≤ 0.5 × |deltaX| vertical
// drift, within 500ms. Tight enough to require an intentional motion.

import { useEffect } from 'react';

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
      if (hasHorizontalScrollAncestor(e.target)) return;
      if (typeof document !== 'undefined' && document.documentElement.dataset.shell === 'catalog-app') return;
      const t = e.touches[0];
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
