// Scroll-glide chrome fade (mobile): while the finger is gliding any
// scrollable surface, `html.is-scroll-gliding` is set so card chrome
// (gradients, creator chips, product text) can retire and let the media
// breathe; ~0.3s after the last scroll event it lifts and the chrome
// eases back in. One capture-phase listener on `document` hears EVERY
// scroller in the app (window, look overlay, product page, rails), so
// no surface needs its own wiring. Desktop and reduced-motion users
// never get the class.

let started = false;

export function initScrollIdleFade(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const mobile = window.matchMedia('(max-width: 960px)');
  let timer = 0;
  let gliding = false;
  const settle = () => {
    gliding = false;
    document.documentElement.classList.remove('is-scroll-gliding');
  };
  const onScroll = () => {
    if (!mobile.matches) { if (gliding) settle(); return; }
    if (!gliding) {
      gliding = true;
      document.documentElement.classList.add('is-scroll-gliding');
    }
    window.clearTimeout(timer);
    timer = window.setTimeout(settle, 320);
  };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
}
