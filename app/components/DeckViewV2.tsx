
import React, { useEffect, useRef, useState } from 'react';
import CatalogLogo from './CatalogLogo';
import ParticleBackground from './ParticleBackground';

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
  const stackW = 78;

  // Running offsets for the stacked column (built bottom-up).
  let stackAcc = 0;

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
          Five storefronts, scattered
        </text>

        {/* Arrow: fragmented -> unified */}
        <g className="deck-v2-chart-arrow">
          <line x1="290" y1={BASE_Y - 120} x2="430" y2={BASE_Y - 120} stroke="rgba(255,255,255,0.45)" strokeWidth="2" />
          <polyline points={`420,${BASE_Y - 128} 432,${BASE_Y - 120} 420,${BASE_Y - 112}`} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>

        {/* Right: one stacked Catalog column (same colours, same scale) */}
        {PLATFORMS.map((p, i) => {
          const h = p.val * SCALE;
          const y = BASE_Y - stackAcc - h;
          stackAcc += h;
          return (
            <rect
              key={p.key}
              className="deck-v2-bar deck-v2-bar-stack"
              x={stackX}
              y={y}
              width={stackW}
              height={h}
              fill={p.color}
              style={{ '--bar-i': i } as React.CSSProperties}
            />
          );
        })}
        {/* Glow frame + label for the Catalog column */}
        <rect
          className="deck-v2-stack-frame"
          x={stackX - 4}
          y={BASE_Y - stackAcc - 4}
          width={stackW + 8}
          height={stackAcc + 4}
          rx="6"
          fill="none"
          stroke="#4ade80"
          strokeWidth="1.5"
        />
        <text className="deck-v2-chart-caption deck-v2-chart-caption-strong" x={stackX + stackW / 2} y={BASE_Y + 22} textAnchor="middle">
          One Catalog feed
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
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);

  // The rising product feed behind the slides. Static public clips (no
  // Supabase dependency in the admin viewer) cycled into a tall grid so the
  // texture is present on slide 1 from the first paint.
  const bgVideos = ['girl2.mp4', 'guy.mp4', 'Untitled.mp4', 'girl.mp4', 'qm1navb8bjo8fjlgjs5x.mp4'];

  const slideTitles = ['Catalog', 'The AI for Shopping', 'What we build', 'The future'];

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

  return (
    <div className="deck-view deck-view-v8 deck-view-v2 deck-v8-bg-revealed active" ref={containerRef}>
      {/* Rising product feed (same drift the longer decks use). Present from
          the first paint so the cover already carries the texture. */}
      <div className="deck-v8-bg deck-v2-bg" aria-hidden="true">
        <div className="deck-insight-grid">
          {Array.from({ length: 24 }).map((_, i) => (
            <video
              key={i}
              src={`${basePath}/${bgVideos[i % bgVideos.length]}`}
              muted
              loop
              playsInline
              autoPlay
              className="deck-insight-video"
            />
          ))}
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
        <h2 className="deck-v2-thesis-h2">Every storefront,<br />one intelligent feed.</h2>
        <p className="deck-v2-thesis-sub">
          Amazon, TikTok, Pinterest, Shop, ShopMy , discovery is scattered across a dozen apps. Catalog folds them into a single feed that learns what you love.
        </p>
        <CombinedChart />
      </div>

      {/* Slide 3: Representative of the company - what we build. */}
      <div className="deck-slide deck-v2-rep">
        <span className="deck-label">What we build</span>
        <h2 className="deck-v2-rep-h2">Creators curate.<br />AI indexes.<br />You shop.</h2>
        <div className="deck-steps deck-v2-pillars">
          <div className="deck-step deck-v2-pillar">
            <span className="deck-step-num">01</span>
            <h3>Taste, not keywords</h3>
            <p>Every look is curated by a creator you trust and indexed by AI , so discovery feels like a friend, not a search bar.</p>
          </div>
          <div className="deck-step deck-v2-pillar">
            <span className="deck-step-num">02</span>
            <h3>Shoppable by default</h3>
            <p>Tap any look to buy the exact products in it. The feed is the storefront , no tab-hopping, no dead ends.</p>
          </div>
          <div className="deck-step deck-v2-pillar">
            <span className="deck-step-num">03</span>
            <h3>Built for everyone</h3>
            <p>Shoppers discover, creators earn on every click, and brands get clean, full-funnel attribution.</p>
          </div>
        </div>
      </div>

      {/* Slide 4: Close. */}
      <div className="deck-slide deck-cover deck-v2-close">
        <CatalogLogo className="deck-logo deck-v2-close-logo" />
        <p className="deck-subtitle deck-v2-close-sub">Human taste, powered by AI.</p>
        <div className="deck-end-actions">
          <button className="deck-mvp-btn" onClick={onSeeApp}>See the product</button>
          <button className="deck-website-btn" onClick={onVisitWebsite}>Visit website</button>
        </div>
      </div>
    </div>
  );
};

export default DeckViewV2;
