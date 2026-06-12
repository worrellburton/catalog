// Scroll-glide chrome fade: while any scrollable surface is gliding,
// `html.is-scroll-gliding` is set so card chrome (gradients, creator
// chips, product text) can retire and let the media breathe. After the
// last scroll event the class lifts and the chrome eases back in —
// ~0.3s later on touch, a full 2s later on desktop (founder's call:
// the desktop feed should rest as pure imagery before resurfacing).
//
// Desktop hover: `html.is-pointing` tracks GENUINE mouse movement —
// set on mousemove, cleared by scrolling. CSS uses it to reveal a
// hovered card's chrome mid-glide, while content scrolling under a
// stationary cursor never lights anything up.
//
// One capture-phase listener on `document` hears EVERY scroller in the
// app (window, look overlay, product page, rails), so no surface needs
// its own wiring. Reduced-motion users never get either class.

let started = false;

export function initScrollIdleFade(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const desktop = window.matchMedia('(min-width: 961px)');
  let timer = 0;
  let gliding = false;
  let pointing = false;
  const settle = () => {
    gliding = false;
    document.documentElement.classList.remove('is-scroll-gliding');
  };
  const onScroll = () => {
    if (!gliding) {
      gliding = true;
      document.documentElement.classList.add('is-scroll-gliding');
    }
    // Scrolling moves content under a stationary cursor — those :hover
    // flips are incidental, so pointing lifts until the mouse truly moves.
    if (pointing) {
      pointing = false;
      document.documentElement.classList.remove('is-pointing');
    }
    window.clearTimeout(timer);
    timer = window.setTimeout(settle, desktop.matches ? 2000 : 320);
  };
  const onMouseMove = () => {
    if (pointing) return;
    pointing = true;
    document.documentElement.classList.add('is-pointing');
  };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  document.addEventListener('mousemove', onMouseMove, { passive: true });
}
