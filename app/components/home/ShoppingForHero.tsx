// ShoppingForHero — the new home entry. A full-viewport matte-black ask
// screen ("What are you shopping for?"). The single search input is the
// app's bottom bar (with filters) — the hero has no pill of its own. The
// catalog feed lives directly below; scrolling reveals the best sellers.

interface ShoppingForHeroProps {
  /** Scroll the page to the home feed below (the "best sellers" hint). */
  onRevealFeed?: () => void;
}

export default function ShoppingForHero({ onRevealFeed }: ShoppingForHeroProps) {
  return (
    <section className="sfh" aria-label="What are you shopping for?">
      <div className="sfh-stage">
        {/* Animated brand mark — a soft 4-point spark that breathes. */}
        <div className="sfh-spark" aria-hidden="true">
          <svg viewBox="0 0 100 100" width="56" height="56">
            <defs>
              <linearGradient id="sfh-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#fff" />
                <stop offset="50%" stopColor="#cbd5e1" />
                <stop offset="100%" stopColor="#94a3b8" />
              </linearGradient>
            </defs>
            <path d="M50 4 C54 30 70 46 96 50 C70 54 54 70 50 96 C46 70 30 54 4 50 C30 46 46 30 50 4 Z" fill="url(#sfh-grad)" />
          </svg>
        </div>

        <h1 className="sfh-title">What are you<br/>shopping for?</h1>
      </div>

      {/* Scroll-to-best-sellers affordance: an animated mouse with a
          dot that travels down, plus a bobbing chevron + label. */}
      <button type="button" className="sfh-scroll-hint" onClick={onRevealFeed} aria-label="Scroll to see best sellers">
        <span className="sfh-mouse" aria-hidden="true"><span className="sfh-mouse-dot" /></span>
        <span className="sfh-scroll-label">Scroll to see best sellers</span>
        <svg className="sfh-scroll-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    </section>
  );
}
