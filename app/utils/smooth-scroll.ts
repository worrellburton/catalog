import Lenis from 'lenis';

// Site-wide smooth scrolling (Lenis) — desktop wheel AND mobile touch.
//
// Honors prefers-reduced-motion, and pauses while the app body-locks for an
// overlay/modal so that surface's own scroller handles the gesture. Scroll-snap
// surfaces (the deck) and any independent scroller opt out via
// [data-lenis-prevent].
//
// NOTE (mobile): syncTouch routes touch through Lenis, which can fight the iOS
// Safari toolbar-collapse behavior the feed relies on (see CLAUDE.md). Enabled
// per request; if the frosted toolbar strip returns on iOS, flip syncTouch back
// off (desktop-only) here.

let lenis: Lenis | null = null;

export function initSmoothScroll(): void {
  if (typeof window === 'undefined' || lenis) return;
  // Reduced motion → native scroll, no smoothing.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  lenis = new Lenis({
    duration: 1.05,
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    syncTouch: true,
    autoRaf: false,
  });

  const raf = (time: number) => {
    lenis?.raf(time);
    window.requestAnimationFrame(raf);
  };
  window.requestAnimationFrame(raf);

  // Pause smoothing whenever the app locks the body (overlays/modals) so the
  // overlay's own inner scroller handles the wheel; resume on the feed.
  const sync = () => {
    if (!lenis) return;
    if (document.body.style.overflow === 'hidden') lenis.stop();
    else lenis.start();
  };
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['style'] });
  sync();
}
