
import React, { useEffect, useRef, useState } from 'react';
import CatalogLogo from './CatalogLogo';

interface DeckViewV8Props {
  onSeeApp: () => void;
  onVisitWebsite: () => void;
  onBack: () => void;
  isLightMode: boolean;
  onToggleTheme: () => void;
}

const DeckViewV8: React.FC<DeckViewV8Props> = ({
  onSeeApp,
  onVisitWebsite,
  onBack,
  isLightMode,
  onToggleTheme,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const [activeFlywheelStep, setActiveFlywheelStep] = useState<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const slides = container.querySelectorAll('.deck-slide');

    const hash = window.location.hash.replace('#', '');
    const slideMatch = hash.match(/^deck\/v8\/(\d+)$/);
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
              window.history.replaceState(null, '', `#deck/v8/${idx + 1}`);
            }
          } else {
            entry.target.classList.remove('visible');
          }
        });
      },
      {
        root: container,
        threshold: 0.5,
      }
    );

    slides.forEach((slide) => observer.observe(slide));

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div className="deck-view deck-view-v8 active" ref={containerRef}>
      <div className="deck-v8-bg" aria-hidden="true">
        <div className="deck-insight-grid">
          {Array.from({ length: 24 }).map((_, i) => (
            <video
              key={i}
              src={`${basePath}/${i % 2 === 0 ? 'girl2.mp4' : 'guy.mp4'}`}
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

      {/* Slide 1: Cover */}
      <div className="deck-slide deck-cover">
        <CatalogLogo className="deck-logo" />
        <p className="deck-subtitle">Investor Deck V.8 for Alex and Dan</p>
      </div>

      {/* Slide 2: Intro: catalog nostalgia + SVG animations */}
      <div className="deck-slide deck-slide-intro deck-v8-intro">
        <div className="deck-intro-svgs" aria-hidden="true">
          {/* Animated floating catalog/book icons */}
          <svg className="deck-intro-icon deck-intro-icon-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
          <svg className="deck-intro-icon deck-intro-icon-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" /></svg>
          <svg className="deck-intro-icon deck-intro-icon-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>
          <svg className="deck-intro-icon deck-intro-icon-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg>
          <svg className="deck-intro-icon deck-intro-icon-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>
          <svg className="deck-intro-icon deck-intro-icon-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
        </div>
        <div className="deck-intro-content">
          <span className="deck-label deck-v8-reveal deck-v8-reveal-1">Intro</span>
          <h2 className="deck-v8-reveal deck-v8-reveal-2">Shopping used to be an experience.</h2>
          <p className="deck-v8-reveal deck-v8-reveal-3">Flipping through a catalog was discovery at its best. Curated, visual, personal. That feeling disappeared when commerce moved online. Catalog brings it back: a platform where every creator&apos;s taste becomes a shoppable storefront, powered by AI infrastructure and built for how people actually shop today.</p>
        </div>
      </div>

      {/* Slide 3: The Problem: split layout with stakeholders stacked right */}
      <div className="deck-slide deck-v8-problem">
        <div className="deck-v8-split-left">
          <span className="deck-label">The Problem</span>
          <h2>Three stakeholders.<br />Three broken experiences.</h2>
        </div>
        <div className="deck-v8-split-right">
          <div className="deck-v8-problem-item">
            <span className="deck-v8-problem-num">01</span>
            <div className="deck-v8-problem-body">
              <h3>Shoppers</h3>
              <p>Discovery is fragmented across social feeds, search engines, and retail sites. The experience is ad-heavy, algorithm-driven, and impersonal. Finding products you actually want feels like work.</p>
            </div>
            <svg className="deck-v8-broken-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle className="broken-circle" cx="12" cy="12" r="10" />
              <line className="broken-x broken-x-1" x1="8.5" y1="8.5" x2="15.5" y2="15.5" />
              <line className="broken-x broken-x-2" x1="15.5" y1="8.5" x2="8.5" y2="15.5" />
            </svg>
          </div>
          <div className="deck-v8-problem-item">
            <span className="deck-v8-problem-num">02</span>
            <div className="deck-v8-problem-body">
              <h3>Creators</h3>
              <p>Monetization is constrained by traditional affiliate structures that pay single-digit commissions and offer zero audience ownership. Creators drive purchases but don&apos;t capture the value they create.</p>
            </div>
            <svg className="deck-v8-broken-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle className="broken-circle" cx="12" cy="12" r="10" />
              <line className="broken-x broken-x-1" x1="8.5" y1="8.5" x2="15.5" y2="15.5" />
              <line className="broken-x broken-x-2" x1="15.5" y1="8.5" x2="8.5" y2="15.5" />
            </svg>
          </div>
          <div className="deck-v8-problem-item">
            <span className="deck-v8-problem-num">03</span>
            <div className="deck-v8-problem-body">
              <h3>Brands</h3>
              <p>Creator-driven commerce is difficult to measure and hard to attribute cleanly. Brands want commerce outcomes, not just impressions, but current tools make ROI opaque.</p>
            </div>
            <svg className="deck-v8-broken-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle className="broken-circle" cx="12" cy="12" r="10" />
              <line className="broken-x broken-x-1" x1="8.5" y1="8.5" x2="15.5" y2="15.5" />
              <line className="broken-x broken-x-2" x1="15.5" y1="8.5" x2="8.5" y2="15.5" />
            </svg>
          </div>
        </div>
      </div>

      {/* Slide 4: The Solution: centered messaging */}
      <div className="deck-slide deck-slide-solution deck-v8-solution">
        <div className="deck-v8-solution-inner">
          <span className="deck-label">The Solution</span>
          <h2>Human taste, amplified by AI.</h2>
          <p>Creators turn their taste into shoppable storefronts. Shoppers browse curated looks and tap to find visually similar products. Brands get measurable, creator-driven distribution. AI does the heavy lifting: visual search, automated tagging, personalized discovery. Every sale routes value back to the people who created it.</p>
        </div>
      </div>

      {/* Slide 5: Three-Sided Value - split layout matching Problem */}
      <div className="deck-slide deck-v8-problem deck-v8-wins">
        <div className="deck-v8-split-left">
          <span className="deck-label">Three-Sided Value</span>
          <h2>Everyone wins.</h2>
        </div>
        <div className="deck-v8-split-right">
          <div className="deck-v8-problem-item">
            <span className="deck-v8-problem-num">01</span>
            <div className="deck-v8-problem-body">
              <h3>For Shoppers</h3>
              <p>An exploratory, curated shopping experience driven by people they trust. No algorithmic noise, no ad fatigue. Discovery that actually feels like discovery.</p>
            </div>
            <svg className="deck-v8-win-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle className="win-circle" cx="12" cy="12" r="10" />
              <polyline className="win-check" points="7.5 12.5 10.5 15.5 16.5 9" />
            </svg>
          </div>
          <div className="deck-v8-problem-item">
            <span className="deck-v8-problem-num">02</span>
            <div className="deck-v8-problem-body">
              <h3>For Creators</h3>
              <p>A new income stream with higher commissions, real audience ownership, and a dedicated storefront for their taste. Style becomes a durable, monetizable asset.</p>
            </div>
            <svg className="deck-v8-win-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle className="win-circle" cx="12" cy="12" r="10" />
              <polyline className="win-check" points="7.5 12.5 10.5 15.5 16.5 9" />
            </svg>
          </div>
          <div className="deck-v8-problem-item">
            <span className="deck-v8-problem-num">03</span>
            <div className="deck-v8-problem-body">
              <h3>For Brands</h3>
              <p>Authentic distribution through trusted voices with measurable commerce outcomes. Guaranteed ROAS visibility and clean attribution on every dollar spent.</p>
            </div>
            <svg className="deck-v8-win-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle className="win-circle" cx="12" cy="12" r="10" />
              <polyline className="win-check" points="7.5 12.5 10.5 15.5 16.5 9" />
            </svg>
          </div>
        </div>
      </div>

      {/* Slide 6: Market Opportunity */}
      <div className="deck-slide deck-v8-market">
        <span className="deck-label">Market Opportunity</span>
        <h2>Three curves, one window.</h2>
        <div className="deck-v8-market-grid">
          {([
            {
              key: 'social',
              value: '$3.2T',
              label: 'Global social commerce by 2035',
              growth: '+31% CAGR',
              // 12 data points for 2024..2035 across x=20..260 (step ~21.8)
              points: '20,122 42,116 64,108 85,98 107,86 129,72 150,58 172,46 194,36 216,28 238,22 260,18',
              source: 'Grand View Research, 2024',
            },
            {
              key: 'creator',
              value: '$1.1T',
              label: 'Creator-driven commerce by 2035',
              growth: '+22% CAGR',
              points: '20,116 42,108 64,98 85,88 107,76 129,64 150,54 172,44 194,36 216,30 238,24 260,20',
              source: 'Goldman Sachs, 2023',
            },
            {
              key: 'trust',
              value: '94%',
              label: 'Shoppers trust creators over ads by 2035',
              growth: '+12% YoY',
              points: '20,108 42,100 64,92 85,82 107,72 129,62 150,54 172,46 194,38 216,30 238,24 260,20',
              source: 'Matter Communications, 2024',
            },
          ]).map((chart) => {
            const points = chart.points.split(' ').map((p) => p.split(',').map(Number) as [number, number]);
            const areaPath = `M ${points.map(([x, y]) => `${x} ${y}`).join(' L ')} L ${points[points.length - 1][0]} 140 L ${points[0][0]} 140 Z`;
            return (
              <div key={chart.key} className="deck-v8-market-card">
                <div className="deck-v8-market-head">
                  <span className="deck-v8-market-value">{chart.value}</span>
                  <span className="deck-v8-market-growth">{chart.growth}</span>
                </div>
                <p className="deck-v8-market-metric">{chart.label}</p>
                <svg className="deck-v8-market-chart" viewBox="0 0 280 180" preserveAspectRatio="xMidYMid meet">
                  <defs>
                    <linearGradient id={`v8mg-${chart.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgba(74,222,128,0.35)" />
                      <stop offset="100%" stopColor="rgba(74,222,128,0)" />
                    </linearGradient>
                    <filter id={`v8mg-glow-${chart.key}`} x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="2.5" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  {/* horizontal grid */}
                  {[20, 50, 80, 110].map((y) => (
                    <line key={y} x1="20" y1={y} x2="260" y2={y} stroke="rgba(255,255,255,0.04)" strokeDasharray="2 4" />
                  ))}
                  {/* x-axis baseline */}
                  <line x1="20" y1="140" x2="260" y2="140" stroke="rgba(255,255,255,0.15)" />
                  {/* area fill */}
                  <path className="v8mc-area" d={areaPath} fill={`url(#v8mg-${chart.key})`} />
                  {/* line */}
                  <polyline
                    className="v8mc-line"
                    points={chart.points}
                    fill="none"
                    stroke="#4ade80"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter={`url(#v8mg-glow-${chart.key})`}
                  />
                  {/* dots */}
                  {points.map(([x, y], i) => (
                    <circle
                      key={i}
                      className="v8mc-dot"
                      cx={x}
                      cy={y}
                      r="2.5"
                      fill="#4ade80"
                      style={{ '--dot-delay': `${1.6 + i * 0.08}s` } as React.CSSProperties}
                    />
                  ))}
                  {/* year labels (show every 2nd year to fit) */}
                  {['2024', '2026', '2028', '2030', '2032', '2035'].map((year) => {
                    const yearNum = parseInt(year, 10);
                    const x = 20 + ((yearNum - 2024) / 11) * 240;
                    return (
                      <g key={year}>
                        <line x1={x} y1="140" x2={x} y2="144" stroke="rgba(255,255,255,0.2)" />
                        <text x={x} y="160" fill="rgba(255,255,255,0.45)" fontSize="9" textAnchor="middle" fontWeight="500">{year}</text>
                      </g>
                    );
                  })}
                </svg>
                <p className="deck-v8-market-source">Source: {chart.source}</p>
              </div>
            );
          })}
        </div>
        <p className="deck-note">Catalog sits where creator economy infrastructure meets social commerce. Not competing with Shopify for merchants or Instagram for attention. Building the commerce layer that connects creators directly to purchase.</p>
      </div>

      {/* Slide 8: The Math */}
      <div className="deck-slide deck-v8-math">
        <div className="deck-v8-math-inner">
          <span className="deck-label">The Math</span>
          <h2>Economics that work for everyone.</h2>
          <div className="deck-scenario">
            <span className="deck-scenario-tag">Scenario</span>
            <p>A creator posts a look featuring a $200 jacket, and a shopper buys it through Catalog.</p>
          </div>
          <table className="math-tbl deck-v8-math-tbl">
          <thead>
            <tr>
              <th className="math-tbl-label"></th>
              <th className="math-tbl-old">Traditional Affiliate</th>
              <th className="math-tbl-new">Catalog (Fixed ROAS)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="math-tbl-label">Brand pays</td>
              <td className="math-val-old">$20<span className="math-pct">(10%)</span></td>
              <td className="math-val-new"><span className="math-check" aria-hidden="true">✓</span>$40<span className="math-pct">(20%)</span></td>
            </tr>
            <tr>
              <td className="math-tbl-label">Creator payout</td>
              <td className="math-val-old">$16<span className="math-pct">(8%)</span></td>
              <td className="math-val-new"><span className="math-check" aria-hidden="true">✓</span>$20<span className="math-pct">(10%)</span></td>
            </tr>
            <tr>
              <td className="math-tbl-label">Platform revenue</td>
              <td className="math-val-old">$4<span className="math-pct">(2%)</span></td>
              <td className="math-val-new"><span className="math-check" aria-hidden="true">✓</span>$20<span className="math-pct">(10%)</span></td>
            </tr>
            <tr>
              <td className="math-tbl-label">Brand cost visibility</td>
              <td className="math-val-dim">Unpredictable</td>
              <td className="math-val-new"><span className="math-check" aria-hidden="true">✓</span><span className="fire-text">Guaranteed 5x ROAS</span></td>
            </tr>
            <tr>
              <td className="math-tbl-label">Attribution</td>
              <td className="math-val-dim">Last-click, lossy</td>
              <td className="math-val-new"><span className="math-check" aria-hidden="true">✓</span>Full-funnel, per-creator</td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>

      {/* Slide 9: Flywheel */}
      <div
        className="deck-slide deck-slide-flywheel-split"
        data-active-step={activeFlywheelStep ?? undefined}
      >
        <div className="flywheel-left">
          <span className="deck-label">Flywheel</span>
          <h2>Build supply first.<br />Demand follows trust.</h2>
          <div className="flywheel-labels">
            {[
              { n: 1, label: 'Seed creators, build supply' },
              { n: 2, label: 'Creators share, audiences arrive' },
              { n: 3, label: 'Shoppers browse, trust, buy' },
              { n: 4, label: 'Creators earn, invest more' },
              { n: 5, label: 'Shoppers become creators' },
            ].map(({ n, label }) => (
              <div
                key={n}
                className="flywheel-label-item"
                onMouseEnter={() => setActiveFlywheelStep(n)}
                onMouseLeave={() => setActiveFlywheelStep(null)}
              >
                <span className="fl-num">{n}</span>
                <p>{label}</p>
              </div>
            ))}
          </div>
          <p>We start with creators because supply drives organic demand. Every creator who publishes a look brings their own audience, their own trust, and their own distribution.</p>
        </div>
        <div className="flywheel-right">
          <div className="flywheel-center">
            <svg className="flywheel-circle-svg" viewBox="0 0 300 300">
              <circle cx="150" cy="150" r="130" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="2" />
              <circle className="flywheel-orbit" cx="150" cy="150" r="130" fill="none" stroke="rgba(74,222,128,0.3)" strokeWidth="2" strokeDasharray="817" strokeDashoffset="817" strokeLinecap="round" />
            </svg>
            {[
              { n: 1, angle: '0deg' },
              { n: 2, angle: '72deg' },
              { n: 3, angle: '144deg' },
              { n: 4, angle: '216deg' },
              { n: 5, angle: '288deg' },
            ].map(({ n, angle }) => (
              <div
                key={n}
                className="flywheel-node"
                style={{ '--angle': angle } as React.CSSProperties}
                onMouseEnter={() => setActiveFlywheelStep(n)}
                onMouseLeave={() => setActiveFlywheelStep(null)}
              >
                <span>{n}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Slide 10: Why Now */}
      <div className="deck-slide">
        <span className="deck-label">Why Now</span>
        <h2>The wedge is open.</h2>
        <p>Creator commerce is fragmenting across dozens of tools while brands are pulling back from awareness spend and demanding measurable ROI. Gen Z doesn&apos;t trust ads but does trust people. Meanwhile, AI has matured enough to power visual search, product matching, and personalized discovery at scale. Catalog brings these forces together: creator trust on the front end, AI intelligence on the back end, and a commerce model that actually works for everyone involved.</p>
      </div>

      {/* Slide 10: Traction */}
      <div className="deck-slide deck-v8-traction">
        <span className="deck-label">Traction</span>
        <h2>Early momentum.</h2>
        <div className="deck-v8-phone-marquee" aria-hidden="true">
          <div className="deck-v8-phone-track">
            {/* Phones list, duplicated for a seamless infinite loop */}
            {[...Array(2)].map((_, loopIdx) => (
              <React.Fragment key={loopIdx}>
                {[
                  'girl2.mp4',
                  'Untitled.mp4',
                  'guy.mp4',
                  'girl2.mp4',
                  'Untitled.mp4',
                  'guy.mp4',
                  'girl2.mp4',
                  'Untitled.mp4',
                ].map((src, i) => (
                  <div key={`${loopIdx}-${i}`} className="deck-app-frame deck-v8-marquee-phone">
                    <video src={`${basePath}/${src}`} autoPlay loop muted playsInline className="deck-app-video" />
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className="deck-stats deck-v8-traction-stats">
          <div className="deck-stat"><span className="deck-stat-num">V1</span><span className="deck-stat-label">Product live and functional</span></div>
          <div className="deck-stat"><span className="deck-stat-num">X</span><span className="deck-stat-label">Active creators</span></div>
          <div className="deck-stat"><span className="deck-stat-num">X</span><span className="deck-stat-label">Looks published</span></div>
          <div className="deck-stat"><span className="deck-stat-num">X</span><span className="deck-stat-label">Brands integrated</span></div>
        </div>
      </div>

      {/* Slide 12: The Ask */}
      <div className="deck-slide">
        <span className="deck-label">The Ask</span>
        <h2>Fuel the flywheel.</h2>
        <div className="deck-raise-summary">
          <div className="deck-raise-item">
            <span className="deck-raise-num">$2.5M</span>
            <span className="deck-raise-label">Round size</span>
          </div>
          <div className="deck-raise-item">
            <span className="deck-raise-num">$12.5M</span>
            <span className="deck-raise-label">SAFE cap</span>
          </div>
          <div className="deck-raise-item">
            <span className="deck-raise-num">Seed</span>
            <span className="deck-raise-label">Stage</span>
          </div>
        </div>
        <p className="deck-note deck-raise-intro">Capital deployed across three priorities to ignite the flywheel.</p>
        <div className="deck-steps">
          <div className="deck-step"><span className="deck-step-num">01</span><h3>Seed the creator side</h3><p>Onboard the first wave of creators and build the content supply that drives organic demand and distribution.</p></div>
          <div className="deck-step"><span className="deck-step-num">02</span><h3>Deepen the product</h3><p>Build product tagging infrastructure, native mobile app, and creator analytics that make Catalog the default tool.</p></div>
          <div className="deck-step"><span className="deck-step-num">03</span><h3>Bring brands on board</h3><p>Launch the fixed-ROAS model with early brand partners and prove the economics that make the marketplace self-sustaining.</p></div>
        </div>
      </div>

      {/* Slide 12: Final */}
      <div className="deck-slide deck-cover">
        <CatalogLogo className="deck-logo" />
        <p className="deck-subtitle">Human Taste, Powered by AI</p>
        <div className="deck-end-actions">
          <button className="deck-mvp-btn" id="deck-mvp-btn" onClick={onSeeApp}>See the product</button>
          <button className="deck-website-btn" id="deck-website-btn" onClick={onVisitWebsite}>Visit website</button>
          <a className="deck-mvp-btn" href={`${basePath}/trademark.pdf`} target="_blank" rel="noopener noreferrer">Trademark</a>
        </div>
      </div>
    </div>
  );
};

export default DeckViewV8;
