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
  // The "Make a catalog for anything" pill stays stowed at the top and
  // reveals once the shopper scrolls down past the hero — it shouldn't sit
  // over the product the moment the page opens.
  const [searchShown, setSearchShown] = useState(false);
  const [q, setQ] = useState('');
  const accum = useRef(0);
  const lastY = useRef(0);

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
        // Reveal the catalog pill once past ~60% of the first screen.
        setSearchShown(y > Math.max(el.clientHeight * 0.6, 280));
        // Always reveal the top bar near the very top.
        if (y < 72) { setHidden(false); accum.current = 0; return; }
        if ((dy > 0 && accum.current >= 0) || (dy < 0 && accum.current <= 0)) accum.current += dy;
        else accum.current = dy;
        if (accum.current > THRESHOLD) setHidden(true);
        else if (accum.current < -THRESHOLD) setHidden(false);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
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
        <div className={`ovl-chrome-search${searchShown ? ' is-shown' : ''}`}>
          <svg className="ovl-chrome-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          <input
            className="ovl-chrome-search-input"
            value={q}
            placeholder="Make a catalog for anything"
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            enterKeyHint="search"
          />
          {q.trim() && (
            <button type="button" className="ovl-chrome-search-go" onClick={submit} aria-label="Search">↑</button>
          )}
        </div>
      )}
    </div>
  );
}
