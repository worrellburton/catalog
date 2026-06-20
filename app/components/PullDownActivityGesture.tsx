// Global mobile gesture: EDGE-pull DOWN from the top of the viewport
// → opens the CreatorConstellation "people & brands" page (a continuation
// of the top creator arc). Replaces the browser's pull-to-refresh on the
// home. Dispatches a `catalog:open-people` window event that _index listens
// for (the page is React state there, not a route). Same guard pattern as
// SwipeMenuGesture so it never fires inside vertical scrollers, modals, or
// the native Flutter shell. (Activity stays reachable via the header pill.)
//
// Skip rules:
//   • Desktop: gesture is disabled (matchMedia max-width 768px).
//   • Flutter shell: native chrome owns vertical gestures.
//   • Input focus: never recognise mid-typing.
//   • Touch starts inside an opted-out container ([data-no-pull-activity]).
//   • Page is scrolled past the top (window.scrollY > 0) — preserves the
//     browser's overscroll-to-refresh and prevents accidental triggers
//     while skimming the feed.
//   • Horizontal-dominant swipes: the user is panning a carousel.
//
// Threshold tuning:
//   • Touch START within 24px of the viewport top edge.
//   • ≥90px downward drag, ≤ 0.5 × |dy| horizontal drift, within 600ms.

import { useEffect } from 'react';

const TOP_EDGE_PX = 24;
const MIN_VERTICAL_PX = 90;
const MAX_DURATION_MS = 600;
const MAX_HORIZONTAL_RATIO = 0.5;

function hasOptOutAncestor(el: EventTarget | null): boolean {
  let node = el as HTMLElement | null;
  while (node && node !== document.body) {
    if (node.nodeType === 1 && node.hasAttribute('data-no-pull-activity')) return true;
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

export default function PullDownActivityGesture() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 768px)');
    let attached = false;

    let startX = 0;
    let startY = 0;
    let startT = 0;
    let active = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { active = false; return; }
      if (focusInInput()) return;
      if (document.documentElement.dataset.shell === 'catalog-app') return;
      const t = e.touches[0];
      // TOP EDGE gate: only arm when the touch lands in the top strip.
      // Lower viewport regions (e.g. mid-feed) are reserved for vertical
      // scrolling so this never collides with the normal feed pan.
      if (t.clientY > TOP_EDGE_PX) return;
      // The feed has to be at the very top — pulling from the middle of
      // a scrolled feed isn't a "discover what's new" gesture, it's a
      // continuation of the scroll the user was already doing.
      if (window.scrollY > 0) return;
      if (hasOptOutAncestor(e.target)) return;
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
      // Positive dy == finger moved down == "pull down to reveal".
      if (dy < MIN_VERTICAL_PX) return;
      if (Math.abs(dx) > Math.abs(dy) * MAX_HORIZONTAL_RATIO) return;
      if (dt > MAX_DURATION_MS) return;
      // _index decides whether to honour it (home active, no overlay open).
      window.dispatchEvent(new CustomEvent('catalog:open-people'));
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
