import Lenis from 'lenis';

// Desktop-only smooth wheel scrolling (Lenis).
//
// Touch is left fully native — syncTouch felt choppy on phones and also fights
// the iOS Safari toolbar-collapse behavior the feed relies on (see CLAUDE.md).
// So Lenis only initializes on fine pointers (mouse/trackpad); mobile keeps
// native momentum scrolling. Honors prefers-reduced-motion, and pauses while
// the app body-locks for an overlay/modal so that surface's own scroller
// handles the wheel. Scroll-snap surfaces (the deck) and any independent
// scroller opt out via [data-lenis-prevent].

let lenis: Lenis | null = null;

export function initSmoothScroll(): void {
  if (typeof window === 'undefined' || lenis) return;
  // Reduced motion → native scroll, no smoothing.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  // Mouse/trackpad only — keep mobile 100% native (no choppy touch smoothing,
  // and the iOS scroll fixes stay intact).
  if (!window.matchMedia?.('(pointer: fine)').matches) return;

  lenis = new Lenis({
    duration: 1.05,
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    syncTouch: false,
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
