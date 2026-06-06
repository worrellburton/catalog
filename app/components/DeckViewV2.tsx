
import React, { useEffect, useMemo, useRef, useState } from 'react';
import CatalogLogo from './CatalogLogo';
import ParticleBackground from './ParticleBackground';
import { getHomeFeed, type ProductAd } from '~/services/product-creative';
import { getLooks } from '~/services/looks';
import type { Look } from '~/data/looks';

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
  { key: 'ltk',       name: 'LTK',       color: '#ec4899', val: 55 },
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
  // Left bars are deliberately small; the Catalog column towers over them so
  // the contrast carries the point at a glance.
  const SCALE = 0.78;
  const leftBarW = 30;
  const leftGap = 14;
  const leftX0 = 30;
  const stackX = 466;
  const stackW = 96;

  // The Catalog column equals the SUM of the five platform bars at the same
  // scale - so it literally reads as "all of them combined into one", not an
  // arbitrarily taller bar.
  const catalogH = PLATFORMS.reduce((sum, p) => sum + p.val, 0) * SCALE;

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

const DeckViewV2: React.FC<DeckViewV2Props> = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  // The rising background mirrors the real catalog: product primary videos
  // AND creator look videos, interleaved. Empty until the fetches land; the
  // dark overlay keeps the slides legible regardless.
  const [homeFeed, setHomeFeed] = useState<ProductAd[]>([]);
  const [looks, setLooks] = useState<Look[]>([]);

  // Background mix is 80% products / 20% creator looks: one look dropped in
  // after every four product clips. Every product appears once; looks cycle
  // to fill the 20% slots.
  const bgClips = useMemo(() => {
    const products = homeFeed
      .filter((p) => !!p.video_url)
      .map((p, i) => ({ key: `p:${p.id}:${i}`, url: p.video_url as string, poster: p.thumbnail_url ?? undefined }));
    const lookClips = looks
      .filter((l) => !!l.video)
      .map((l, i) => ({ key: `l:${l.uuid ?? l.id}:${i}`, url: l.video, poster: l.thumbnail_url }));
    if (products.length === 0) return lookClips;
    if (lookClips.length === 0) return products;
    const out: { key: string; url: string; poster?: string }[] = [];
    let li = 0;
    products.forEach((p, idx) => {
      out.push(p);
      if (idx % 4 === 3) {
        out.push(lookClips[li % lookClips.length]);
        li += 1;
      }
    });
    return out;
  }, [homeFeed, looks]);

  const slideTitles = ['Catalog', 'The AI for Shopping', 'Human taste', 'Market', 'Partnership', 'The future'];

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
    getLooks()
      .then((list) => {
        if (!cancelled) setLooks(list.filter((l) => !!l.video));
      })
      .catch((err) => {
        console.error('[DeckViewV2] getLooks failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="deck-view deck-view-v8 deck-view-v2 deck-v8-bg-revealed active" ref={containerRef}>
      {/* Rising feed (same drift the longer decks use), sourced from the live
          catalog: product creatives + creator looks interleaved. Up to 48
          tiles cycle through the combined pool so even a small set fills the
          tall grid edge-to-edge. */}
      <div className="deck-v8-bg deck-v2-bg" aria-hidden="true">
        <div className="deck-insight-grid">
          {Array.from({ length: bgClips.length === 0 ? 0 : 48 }).map((_, i) => {
            const clip = bgClips[i % bgClips.length];
            return (
              <video
                key={`${clip.key}:${i}`}
                src={clip.url}
                poster={clip.poster}
                preload="metadata"
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
          Amazon, TikTok, Pinterest, LTK, ShopMy , shopping is scattered across a dozen apps. Catalog does what all of them do , in one. The AI platform for shopping.
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
            <h3>Elegant discovery</h3>
            <p>Every look is curated by a creator you trust and indexed by AI , so finding what you want feels like a recommendation from a friend, not a search bar.</p>
          </div>
          <div className="deck-step deck-v2-pillar">
            <span className="deck-step-num">02</span>
            <h3>Revenue source for creators</h3>
            <p>Creators earn three ways , their own affiliate links, brand-direct deals we sign as a Shopify app, and daily payouts on engagement.</p>
          </div>
          <div className="deck-step deck-v2-pillar">
            <span className="deck-step-num">03</span>
            <h3>Built for everyone</h3>
            <p>Built for all demographics, every kind of shopping, and all categories , not one niche.</p>
          </div>
        </div>
      </div>

      {/* Slide 4: Market opportunity - a global AI shopping platform. */}
      <div className="deck-slide deck-v2-market">
        <span className="deck-label">Market Opportunity</span>
        <h2 className="deck-v2-market-h2">If shopping runs through one AI,<br />the market is all of it.</h2>
        <p className="deck-v2-market-sub">
          Catalog isn&apos;t chasing a slice of commerce , it&apos;s the shopping layer for the whole thing. A global AI platform for shopping has a ceiling the size of retail itself.
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
        <p className="deck-note deck-v2-market-note">Directional , global retail + e-commerce scale. The point: an AI platform for shopping has a TAM the size of commerce itself.</p>
      </div>

      {/* Slide 5: Potential partnership - exclusive affiliate rights. */}
      <div className="deck-slide deck-v2-partner">
        <span className="deck-label">Potential Partnership</span>
        <h2 className="deck-v2-partner-h2">Exclusive affiliate rights.<br />A partnership that compounds.</h2>
        <p className="deck-v2-partner-sub">
          Catalog runs on your affiliate network , exclusively. You earn on every sale we drive, and your equity in Catalog grows as the platform scales.
        </p>
        <div className="deck-v2-partner-cards">
          <div className="deck-v2-partner-card">
            <span className="deck-v2-partner-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M14.8 9.2A2.4 2.4 0 0 0 12.6 8h-1.2a2.2 2.2 0 0 0 0 4.4h1.2a2.2 2.2 0 0 1 0 4.4h-1.2A2.4 2.4 0 0 1 9.2 15.6" /><path d="M12 6.4v1.2M12 16.4v1.2" /></svg>
            </span>
            <h3>Earn cash now</h3>
            <p>Every purchase through Catalog flows through your affiliate links. You get paid from day one, on the volume we generate.</p>
          </div>
          <div className="deck-v2-partner-plus" aria-hidden="true">+</div>
          <div className="deck-v2-partner-card">
            <span className="deck-v2-partner-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 7-7" /><path d="M14 8h6v6" /></svg>
            </span>
            <h3>Asset value grows</h3>
            <p>As an equity partner, your stake compounds with the platform. The bigger Catalog gets, the more your position is worth.</p>
          </div>
        </div>
        <p className="deck-note deck-v2-partner-note">Exclusive rights , cash today, asset value tomorrow. A partnership built to win on both sides.</p>
      </div>

      {/* Slide 6: Close - Catalog wordmark + the assets we hold. */}
      <div className="deck-slide deck-cover deck-v2-close">
        <CatalogLogo className="deck-logo deck-v2-close-logo" />
        <p className="deck-subtitle deck-v2-close-sub">The AI platform for shopping.</p>
        <span className="deck-label deck-v2-holding-label">Holding</span>
        <div className="deck-v2-close-pills">
          <a className="deck-v2-ig-btn" href="https://instagram.com/catalog" target="_blank" rel="noopener noreferrer">
            <svg className="deck-v2-ig-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
              <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
              <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
            </svg>
            @catalog
          </a>
          <a className="deck-v2-tm-pill" href={`${basePath}/trademark.pdf`} target="_blank" rel="noopener noreferrer">
            <svg className="deck-v2-tm-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="9" y1="13" x2="15" y2="13" />
              <line x1="9" y1="17" x2="13" y2="17" />
            </svg>
            Trademark
          </a>
        </div>
      </div>
    </div>
  );
};

export default DeckViewV2;
