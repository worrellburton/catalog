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
import { setPeoplePull, snapPeople } from '~/utils/peoplePanel';

const MIN_VERTICAL_PX = 96;
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
    let active = false;
    let pulling = false;

    const onTouchStart = (e: TouchEvent) => {
      active = false;
      pulling = false;
      if (e.touches.length !== 1) return;
      if (focusInInput()) return;
      if (document.documentElement.dataset.shell === 'catalog-app') return;
      // The feed must be at the very top — only there is a downward drag a
      // "pull to reveal" rather than a continuation of a scroll.
      if (window.scrollY > 0) return;
      if (hasOptOutAncestor(e.target)) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      active = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!active) return;
      const t = e.touches[0];
      if (!t) return;
      const dy = t.clientY - startY;
      const dx = t.clientX - startX;
      // Reversed into an upward scroll, drifted sideways, or the page started
      // scrolling → hand the gesture back to the browser.
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy) * MAX_HORIZONTAL_RATIO || window.scrollY > 0) {
        active = false;
        if (pulling) { pulling = false; snapPeople(false); }
        return;
      }
      // Pulling DOWN at the very top: suppress the browser's native
      // pull-to-refresh so our page-open owns the gesture (needs a
      // non-passive listener), and reveal the page above 1:1 with the finger.
      pulling = true;
      setPeoplePull(Math.min(1, dy / ((window.innerHeight || 800) * 0.9)));
      if (e.cancelable) e.preventDefault();
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!active) return;
      active = false;
      if (!pulling) return;
      pulling = false;
      const t = e.changedTouches[0];
      const dx = t ? t.clientX - startX : 0;
      const dy = t ? t.clientY - startY : 0;
      const commit = !!t && dy >= MIN_VERTICAL_PX && Math.abs(dx) <= Math.abs(dy) * MAX_HORIZONTAL_RATIO;
      if (commit) {
        // _index decides whether to honour it (home active, no overlay open)
        // and snaps the panel fully open; otherwise it snaps back.
        window.dispatchEvent(new CustomEvent('catalog:open-people'));
      } else {
        snapPeople(false);
      }
    };

    const attach = () => {
      if (attached) return;
      attached = true;
      window.addEventListener('touchstart', onTouchStart, { passive: true });
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', onTouchEnd, { passive: true });
    };
    const detach = () => {
      if (!attached) return;
      attached = false;
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
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
