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
  // How long after the last scroll event hover effects come back on their own
  // (even if the cursor never moves) — founder's call: hover OFF while
  // scrolling, back ON ~1s after the browser pauses.
  const HOVER_RESUME_MS = 1000;
  let timer = 0;
  let hoverTimer = 0;
  let gliding = false;
  let pointing = false;
  const setPointing = (on: boolean) => {
    if (on === pointing) return;
    pointing = on;
    document.documentElement.classList.toggle('is-pointing', on);
  };
  const settle = () => {
    gliding = false;
    document.documentElement.classList.remove('is-scroll-gliding');
  };
  const onScroll = () => {
    if (!gliding) {
      gliding = true;
      document.documentElement.classList.add('is-scroll-gliding');
    }
    // Scrolling moves content under a stationary cursor — those :hover flips
    // are incidental, so hover lifts for the duration of the scroll.
    setPointing(false);
    window.clearTimeout(timer);
    timer = window.setTimeout(settle, desktop.matches ? 2000 : 320);
    // Bring hover back a beat after scrolling STOPS, without needing a mouse
    // move — so a cursor resting over a card lights it up once the feed
    // settles.
    window.clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => setPointing(true), HOVER_RESUME_MS);
  };
  const onMouseMove = () => {
    // A genuine mouse move while the feed is settled re-enables hover at once;
    // moves DURING a scroll are ignored so hover stays off until it stops.
    if (gliding) return;
    setPointing(true);
  };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  document.addEventListener('mousemove', onMouseMove, { passive: true });
}
