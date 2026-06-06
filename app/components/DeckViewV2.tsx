
import React, { useEffect, useRef, useState } from 'react';
import CatalogLogo from './CatalogLogo';
import ParticleBackground from './ParticleBackground';
import { getHomeFeed, type ProductAd } from '~/services/product-creative';

interface DeckViewV2Props {
  onSeeApp: () => void;
  onVisitWebsite: () => void;
  onBack: () => void;
  isLightMode: boolean;
  onToggleTheme: () => void;
}

/*
 * DeckViewV2 - the short "4-page" deck.
 *
 * A deliberately tight, four-slide story that leans on the same vocabulary
 * as the longer decks (particle field + slowly-rising product feed behind
 * matte-black slides) but distills the pitch to four scroll-snapped beats:
 *
 *   1. Cover           - just the Catalog wordmark over the live texture.
 *   2. The AI for Shopping - the headline + a single chart that folds
 *      Amazon, TikTok, Pinterest, Shop and ShopMy into one Catalog column.
 *   3. Representative  - what the company is, in three pillars.
 *   4. Close           - the wordmark, the tagline, and the CTAs.
 *
 * Built to read identically on desktop and mobile: every slide centres,
 * the chart is a single viewBox SVG that scales uniformly, and the legend
 * + pillars reflow to one column under 768px via the shared deck CSS.
 */

// The five fragmented commerce surfaces Catalog sits on top of. Order +
// colour are shared between the left "fragmented" bars and the stacked
// "Catalog" column so the eye reads "these five, together, are Catalog".
// `val` is a directional weight (not a precise GMV figure) - it only sets
// each segment's share of the combined column.
const PLATFORMS: { key: string; name: string; color: string; val: number }[] = [
  { key: 'amazon',    name: 'Amazon',    color: '#ff9900', val: 75 },
  { key: 'tiktok',    name: 'TikTok',    color: '#25f4ee', val: 45 },
  { key: 'pinterest', name: 'Pinterest', color: '#e60023', val: 30 },
  { key: 'shop',      name: 'Shop',      color: '#95bf47', val: 55 },
  { key: 'shopmy',    name: 'ShopMy',    color: '#a78bfa', val: 20 },
];

/* The combined-surface chart for slide 2. Five single-colour bars on the
   left (each platform, standing alone) feed an arrow into one stacked
   column on the right whose segments are the same five colours at the same
   scale - so the column is literally the five bars summed. Everything grows
   from the baseline once the slide is .visible. */
function CombinedChart() {
  // Geometry in SVG user units; the viewBox scales the whole thing on mobile.
  const BASE_Y = 290;
  const SCALE = 1; // 1 unit of `val` == 1px tall, shared by both sides.
  const leftBarW = 30;
  const leftGap = 14;
  const leftX0 = 30;
  const stackX = 470;
  const stackW = 82;

  // The Catalog column is one unified bar - NOT the five platforms stacked.
  // Its height tops the scattered bars so it reads as "the one place that
  // does what all of them do", not "all of them folded together".
  const catalogH = 232;

  return (
    <div className="deck-v2-chart">
      <svg className="deck-v2-chart-svg" viewBox="0 0 600 340" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Amazon, TikTok, Pinterest, Shop and ShopMy combining into one Catalog feed">
        {/* baseline */}
        <line x1="18" y1={BASE_Y} x2="582" y2={BASE_Y} stroke="rgba(255,255,255,0.15)" />

        {/* Left: five fragmented single-colour bars */}
        {PLATFORMS.map((p, i) => {
          const h = p.val * SCALE;
          const x = leftX0 + i * (leftBarW + leftGap);
          return (
            <g key={p.key}>
              <rect
                className="deck-v2-bar deck-v2-bar-left"
                x={x}
                y={BASE_Y - h}
                width={leftBarW}
                height={h}
                rx="3"
                fill={p.color}
                style={{ '--bar-i': i } as React.CSSProperties}
              />
            </g>
          );
        })}
        <text className="deck-v2-chart-caption" x={leftX0 + (5 * leftBarW + 4 * leftGap) / 2} y={BASE_Y + 22} textAnchor="middle">
          Five apps, scattered
        </text>

        {/* Arrow: fragmented -> unified */}
        <g className="deck-v2-chart-arrow">
          <line x1="290" y1={BASE_Y - 120} x2="430" y2={BASE_Y - 120} stroke="rgba(255,255,255,0.45)" strokeWidth="2" />
          <polyline points={`420,${BASE_Y - 128} 432,${BASE_Y - 120} 420,${BASE_Y - 112}`} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>

        {/* Right: one unified Catalog column. A single solid bar - Catalog
            is the one AI that does what all of them do, not the five
            platforms folded together into a stack. */}
        <rect
          className="deck-v2-bar deck-v2-bar-catalog"
          x={stackX}
          y={BASE_Y - catalogH}
          width={stackW}
          height={catalogH}
          rx="5"
          fill="#4ade80"
          style={{ '--bar-i': 0 } as React.CSSProperties}
        />
        <text className="deck-v2-chart-caption deck-v2-chart-caption-strong" x={stackX + stackW / 2} y={BASE_Y + 22} textAnchor="middle">
          One AI to shop
        </text>
      </svg>

      {/* Legend ties each colour back to its platform; wraps under 768px. */}
      <ul className="deck-v2-legend">
        {PLATFORMS.map((p) => (
          <li key={p.key} className="deck-v2-legend-item">
            <span className="deck-v2-legend-dot" style={{ background: p.color }} aria-hidden="true" />
            {p.name}
          </li>
        ))}
        <li className="deck-v2-legend-item deck-v2-legend-item-sum">
          <span className="deck-v2-legend-dot deck-v2-legend-dot-sum" aria-hidden="true" />
          Catalog
        </li>
      </ul>
    </div>
  );
}

const DeckViewV2: React.FC<DeckViewV2Props> = ({
  onSeeApp,
  onVisitWebsite,
  onBack,
  isLightMode,
  onToggleTheme,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  // The rising background mirrors the real consumer home feed - every
  // product with a polished primary video (products.primary_video_url),
  // not stock clips. Empty until the fetch lands; the dark overlay keeps
  // the slides legible regardless.
  const [homeFeed, setHomeFeed] = useState<ProductAd[]>([]);

  const slideTitles = ['Catalog', 'The AI for Shopping', 'Human taste', 'Market', 'The future'];

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const slides = container.querySelectorAll('.deck-slide');

    const hash = window.location.hash.replace('#', '');
    const slideMatch = hash.match(/^deck\/v2\/(\d+)$/);
    if (slideMatch) {
      const idx = parseInt(slideMatch[1], 10) - 1;
      if (idx >= 0 && idx < slides.length) {
        slides[idx].scrollIntoView();
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            const idx = Array.from(slides).indexOf(entry.target);
            if (idx >= 0) {
              window.history.replaceState(null, '', `#deck/v2/${idx + 1}`);
              setActiveSlideIdx(idx);
            }
          } else {
            entry.target.classList.remove('visible');
          }
        });
      },
      { root: container, threshold: 0.5 }
    );

    slides.forEach((slide) => observer.observe(slide));
    return () => observer.disconnect();
  }, []);

  // Pull the real home feed once on mount. Same contract as the consumer
  // app and Deck v1.2: products with a live primary video. ignoreGender so
  // the background shows the full catalog, not the current toggle's slice.
  // Filtered to rows that actually have a video_url so the grid stays
  // motion-only.
  useEffect(() => {
    let cancelled = false;
    getHomeFeed({ ignoreGender: true })
      .then((list) => {
        if (!cancelled) setHomeFeed(list.filter((r) => !!r.video_url));
      })
      .catch((err) => {
        console.error('[DeckViewV2] getHomeFeed failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="deck-view deck-view-v8 deck-view-v2 deck-v8-bg-revealed active" ref={containerRef}>
      {/* Rising product feed (same drift the longer decks use), sourced from
          the live catalog's primary product videos. Up to 48 tiles cycle
          through the feed (homeFeed[i % len]) so even a small live pool
          fills the tall grid edge-to-edge. */}
      <div className="deck-v8-bg deck-v2-bg" aria-hidden="true">
        <div className="deck-insight-grid">
          {Array.from({ length: homeFeed.length === 0 ? 0 : 48 }).map((_, i) => {
            const clip = homeFeed[i % homeFeed.length];
            return (
              <video
                key={`${clip.id}:${i}`}
                src={clip.video_url ?? undefined}
                muted
                loop
                playsInline
                autoPlay
                className="deck-insight-video"
              />
            );
          })}
        </div>
        <div className="deck-insight-overlay" />
      </div>

      {/* Ambient particle field over the feed. `speed` makes this a one-off
          mount that always renders (no shared singleton on the admin route). */}
      <div className="deck-v2-particles" aria-hidden="true">
        <ParticleBackground speed={0.7} />
      </div>

      <button className="deck-back-btn" onClick={onBack} aria-label="Back to decks">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <button className="deck-theme-toggle" onClick={onToggleTheme}>
        {isLightMode ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
        )}
      </button>

      {/* Left-side nav dots with hover-reveal slide labels */}
      <nav className="deck-v9-nav" aria-label="Deck navigation">
        {slideTitles.map((title, idx) => (
          <button
            key={idx}
            type="button"
            className={`deck-v9-nav-dot${idx === activeSlideIdx ? ' is-active' : ''}`}
            aria-label={`Jump to ${title}`}
            onClick={() => {
              const slides = containerRef.current?.querySelectorAll('.deck-slide');
              if (slides && slides[idx]) slides[idx].scrollIntoView({ behavior: 'smooth' });
            }}
          >
            <span className="deck-v9-nav-dot-mark" />
            <span className="deck-v9-nav-dot-label">{title}</span>
          </button>
        ))}
      </nav>

      {/* Slide 1: Cover - just the wordmark over the texture. */}
      <div className="deck-slide deck-cover deck-v2-cover">
        <CatalogLogo className="deck-logo deck-v2-cover-logo" />
        <p className="deck-subtitle deck-v2-cover-sub">The AI for shopping</p>
        <span className="deck-v2-scroll-cue" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
        </span>
      </div>

      {/* Slide 2: The AI for Shopping - combined-surface chart. */}
      <div className="deck-slide deck-v2-thesis">
        <span className="deck-label">The AI for shopping</span>
        <h2 className="deck-v2-thesis-h2">Everything they do.<br />One AI to shop.</h2>
        <p className="deck-v2-thesis-sub">
          Amazon, TikTok, Pinterest, Shop, ShopMy , shopping is scattered across a dozen apps. Catalog does what all of them do , in one. The AI you go to shop.
        </p>
        <CombinedChart />
      </div>

      {/* Slide 3: Representative of the company. */}
      <div className="deck-slide deck-v2-rep">
        <span className="deck-label">What we build</span>
        <h2 className="deck-v2-rep-h2">Human taste,<br />powered by AI.</h2>
        <p className="deck-v2-rep-sub">Creators curate. AI indexes. Shoppers shop.</p>
        <div className="deck-steps deck-v2-pillars">
          <div className="deck-step deck-v2-pillar">
            <span className="deck-step-num">01</span>
            <h3>Elegant discovery like never before</h3>
            <p>Every look is curated by a creator you trust and indexed by AI , so discovery feels like a friend, not a search bar.</p>
          </div>
          <div className="deck-step deck-v2-pillar">
            <span className="deck-step-num">02</span>
            <h3>The best revenue source for creators out there</h3>
            <p>Earn on every click , layered affiliate, brand-direct, and referral income that compounds daily. No better place to monetize taste.</p>
          </div>
          <div className="deck-step deck-v2-pillar">
            <span className="deck-step-num">03</span>
            <h3>Built for everyone</h3>
            <p>Shoppers discover, creators earn on every click, and brands get clean, full-funnel attribution.</p>
          </div>
        </div>
      </div>

      {/* Slide 4: Market opportunity - a global AI shopping platform. */}
      <div className="deck-slide deck-v2-market">
        <span className="deck-label">Market Opportunity</span>
        <h2 className="deck-v2-market-h2">If shopping runs through one AI,<br />the market is all of it.</h2>
        <p className="deck-v2-market-sub">
          Catalog isn&apos;t chasing a slice of commerce , it&apos;s the shopping layer for the whole thing. A global AI you go to shop has a ceiling the size of retail itself.
        </p>
        <div className="deck-stats deck-v2-market-stats">
          <div className="deck-stat">
            <span className="deck-stat-num">$32T</span>
            <span className="deck-stat-label">Global retail spend a year , the ceiling for an AI you shop through</span>
            <div className="stat-growth">
              <div className="growth-line" style={{ '--grow-width': '70%' } as React.CSSProperties} />
              <span className="growth-rate">all commerce</span>
            </div>
          </div>
          <div className="deck-stat">
            <span className="deck-stat-num">$6.9T</span>
            <span className="deck-stat-label">Online by 2027, growing double digits while stores stay flat</span>
            <div className="stat-growth">
              <div className="growth-line" style={{ '--grow-width': '88%' } as React.CSSProperties} />
              <span className="growth-rate">+9% CAGR</span>
            </div>
          </div>
          <div className="deck-stat">
            <span className="deck-stat-num">$69B</span>
            <span className="deck-stat-label">Just 1% of global e-commerce routed through Catalog</span>
            <div className="stat-growth">
              <div className="growth-line" style={{ '--grow-width': '38%' } as React.CSSProperties} />
              <span className="growth-rate">our wedge</span>
            </div>
          </div>
        </div>
        <p className="deck-note deck-v2-market-note">Directional , global retail + e-commerce scale. The point: an AI you go to shop has a TAM the size of commerce itself.</p>
      </div>

      {/* Slide 5: Close. */}
      <div className="deck-slide deck-cover deck-v2-close">
        <CatalogLogo className="deck-logo deck-v2-close-logo" />
        <p className="deck-subtitle deck-v2-close-sub">The AI you go to shop.</p>
        <div className="deck-end-actions">
          <button className="deck-mvp-btn" onClick={onSeeApp}>See the product</button>
          <button className="deck-website-btn" onClick={onVisitWebsite}>Visit website</button>
        </div>
      </div>
    </div>
  );
};

export default DeckViewV2;
