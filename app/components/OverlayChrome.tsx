// Shared scroll-reactive chrome for the full-screen overlays (product &
// look pages). Mirrors the home feed's behaviour: a top bar (back +
// Catalog logo) and a bottom search pill that hide as you scroll DOWN
// into the page and come back UP when you scroll up or reach the top.
//   • Back  → the previous page (the overlay's own close/history-back).
//   • Logo  → home (resets to the feed).
//   • Search→ closes the overlay and runs the query on the feed.
// Mobile-first: on desktop the overlays keep their existing back rails,
// so this is gated to phones in CSS.

import { useEffect, useRef, useState } from 'react';
import CatalogLogo from '~/components/CatalogLogo';
import '~/styles/overlay-chrome.css';

interface Props {
  scrollEl: HTMLElement | null;
  onBack: () => void;
  onHome: () => void;
  onSearch: (q: string) => void;
  /** The look overlay already surfaces the app search bar deep in its
   *  daily-feed section, so it opts out of the chrome's own pill. */
  showSearch?: boolean;
}

export default function OverlayChrome({ scrollEl, onBack, onHome, onSearch, showSearch = true }: Props) {
  const [hidden, setHidden] = useState(false);
  // The "Make a catalog for anything" pill is HERO-ONLY (mirrors the home
  // BottomBar): it shows near the TOP of the page and LEAVES once the shopper
  // scrolls into the feed, so it never sits in the bottom pill zone behind iOS
  // Safari's translucent URL pill (where a white bar read as a dark band). The
  // page opens at the top, so start shown.
  const [searchShown, setSearchShown] = useState(true);
  const [q, setQ] = useState('');
  const accum = useRef(0);
  const lastY = useRef(0);
  const idle = useRef(0);

  useEffect(() => {
    const el = scrollEl;
    if (!el) return;
    lastY.current = el.scrollTop;
    accum.current = 0;
    let raf = 0;
    const THRESHOLD = 10;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = el.scrollTop;
        const dy = y - lastY.current;
        lastY.current = y;
        // Hero-only: show the catalog pill near the TOP and hide it once the
        // shopper scrolls past ~60% of the first screen into the feed — so the
        // strip behind iOS Safari's collapsed URL pill is pure feed cards, not
        // a white bar reading as a dark band. (Mirrors the home BottomBar; was
        // reveal-on-scroll-down, which put the bar exactly in the pill zone.)
        setSearchShown(y < Math.max(el.clientHeight * 0.6, 280));
        // Rest return: a short idle after the last scroll eases the chrome
        // (top bar + search pill) back, matching the home feed — so they
        // never stay gone once the shopper stops scrolling.
        window.clearTimeout(idle.current);
        idle.current = window.setTimeout(() => setHidden(false), 2000);
        // Always reveal the top bar near the very top.
        if (y < 72) { setHidden(false); accum.current = 0; return; }
        if ((dy > 0 && accum.current >= 0) || (dy < 0 && accum.current <= 0)) accum.current += dy;
        else accum.current = dy;
        if (accum.current > THRESHOLD) setHidden(true);
        else if (accum.current < -THRESHOLD) setHidden(false);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(idle.current);
    };
  }, [scrollEl]);

  const submit = () => { const v = q.trim(); if (v) onSearch(v); };

  return (
    <div className={`ovl-chrome${hidden ? ' is-hidden' : ''}`} aria-hidden={hidden}>
      <div className="ovl-chrome-top">
        <button type="button" className="ovl-chrome-back" onClick={onBack} aria-label="Back">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <button type="button" className="ovl-chrome-logo" onClick={onHome} aria-label="Home">
          <CatalogLogo className="ovl-chrome-logo-mark" />
        </button>
        <span className="ovl-chrome-spacer" aria-hidden="true" />
      </div>
      {showSearch && (
        <div className={`ovl-chrome-search${searchShown && !hidden ? ' is-shown' : ''}`}>
          {/* Filter/sliders icon — matches the main feed's BottomBar leading
              icon so the search bar reads identically everywhere. */}
          <svg className="ovl-chrome-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/></svg>
          <input
            className="ovl-chrome-search-input"
            value={q}
            placeholder="Make a catalog for anything"
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            enterKeyHint="search"
          />
        </div>
      )}
    </div>
  );
}
