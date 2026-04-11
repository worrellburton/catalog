
import React, { useEffect, useRef, useState } from 'react';
import CatalogLogo from './CatalogLogo';

interface DeckViewV9Props {
  onSeeApp: () => void;
  onVisitWebsite: () => void;
  onBack: () => void;
  isLightMode: boolean;
  onToggleTheme: () => void;
}

/* Math table animated check/X icons */
const MathCheckIcon: React.FC = () => (
  <svg className="math-icon math-check-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <circle className="math-icon-circle" cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.4" />
    <polyline className="math-icon-stroke" points="6.2 10.4 9 13.2 14 7.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const MathXIcon: React.FC = () => (
  <svg className="math-icon math-x-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <circle className="math-icon-circle" cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.4" />
    <line className="math-icon-stroke math-icon-x-1" x1="7.2" y1="7.2" x2="12.8" y2="12.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <line className="math-icon-stroke math-icon-x-2" x1="12.8" y1="7.2" x2="7.2" y2="12.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/* Flywheel step icons: five lucide-style line icons that map to the loop */
const flywheelIconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const SproutIcon: React.FC = () => (
  <svg className="fl-icon" {...flywheelIconProps}>
    <path d="M7 20h10" />
    <path d="M10 20c5.5-2.5.8-6.4 3-10" />
    <path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z" />
    <path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z" />
  </svg>
);
const ShareIcon: React.FC = () => (
  <svg className="fl-icon" {...flywheelIconProps}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
);
const BagIcon: React.FC = () => (
  <svg className="fl-icon" {...flywheelIconProps}>
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
    <path d="M3 6h18" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);
const CoinIcon: React.FC = () => (
  <svg className="fl-icon" {...flywheelIconProps}>
    <circle cx="12" cy="12" r="10" />
    <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
    <path d="M12 18V6" />
  </svg>
);
const CycleIcon: React.FC = () => (
  <svg className="fl-icon" {...flywheelIconProps}>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </svg>
);

const flywheelSteps: { n: number; angle: string; label: string; sub: string; icon: React.ReactNode }[] = [
  { n: 1, angle: '0deg',   label: 'Onboard creators',     sub: 'Free tools, fast payouts, instant storefronts.',        icon: <SproutIcon /> },
  { n: 2, angle: '72deg',  label: 'Creators publish',     sub: 'Each look ships with its own built-in audience.',      icon: <ShareIcon /> },
  { n: 3, angle: '144deg', label: 'Shoppers buy on trust', sub: 'Trusted voices convert 3-5× better than paid ads.',    icon: <BagIcon /> },
  { n: 4, angle: '216deg', label: 'Earnings + data return', sub: 'Top creators reinvest. The feed learns what sells.', icon: <CoinIcon /> },
  { n: 5, angle: '288deg', label: 'The loop compounds',   sub: 'CAC drops. LTV climbs. Trust deepens every quarter.',  icon: <CycleIcon /> },
];

/* 16-month roadmap phases for the Roadmap timeline slide.
   start/end are in months (0..16). Bars render proportionally over a 16-month track. */
const roadmapPhases: { label: string; sub: string; start: number; end: number; color: string }[] = [
  { label: 'Closed Beta',           sub: 'Invite-only creators, core feed, bookmarking.',          start: 0,  end: 3,  color: '#a78bfa' },
  { label: 'Creator Tools v1',      sub: 'Storefronts, fast payouts, analytics dashboard.',       start: 1,  end: 5,  color: '#fb923c' },
  { label: 'AI Visual Discovery',   sub: 'Vector search, auto-tagging, look-to-look recs.',       start: 3,  end: 8,  color: '#38bdf8' },
  { label: 'Brand Portal + Shopify', sub: 'Self-serve onboarding, product sync, attribution.',    start: 4,  end: 9,  color: '#f97316' },
  { label: 'Public iOS Launch',     sub: 'Native app, social sharing, growth loops live.',        start: 7,  end: 11, color: '#34d399' },
  { label: 'Fixed-ROAS Ad Network', sub: 'Guaranteed-outcome placements, audience targeting.',    start: 9,  end: 14, color: '#f5c542' },
  { label: 'Series A + Scale',      sub: 'Hire to GTM, geo expansion, category breadth.',         start: 13, end: 16, color: '#f43f5e' },
];

const DeckViewV9: React.FC<DeckViewV9Props> = ({
  onSeeApp,
  onVisitWebsite,
  onBack,
  isLightMode,
  onToggleTheme,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const [activeFlywheelStep, setActiveFlywheelStep] = useState<number | null>(null);
  const [bgRevealed, setBgRevealed] = useState(false);
  const [techActiveSeed, setTechActiveSeed] = useState<number | null>(null);
  const techVideos = ['girl2.mp4', 'guy.mp4', 'Untitled.mp4', 'girl.mp4', 'qm1navb8bjo8fjlgjs5x.mp4'];
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const slideTitles = [
    'Cover',
    'The Dream',
    'The Problem',
    'The Solution',
    'Market Opportunity',
    'The Math',
    'Flywheel',
    'Technology',
    'Traction',
    'The Ask',
    'Roadmap',
    'Closing',
  ];

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const slides = container.querySelectorAll('.deck-slide');

    const hash = window.location.hash.replace('#', '');
    const slideMatch = hash.match(/^deck\/v9\/(\d+)$/);
    if (slideMatch) {
      const idx = parseInt(slideMatch[1], 10) - 1;
      if (idx >= 0 && idx < slides.length) {
        slides[idx].scrollIntoView();
        // If we deep-linked past the cover, reveal the bg right away.
        if (idx > 0) setBgRevealed(true);
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            const idx = Array.from(slides).indexOf(entry.target);
            if (idx >= 0) {
              window.history.replaceState(null, '', `#deck/v9/${idx + 1}`);
              setActiveSlideIdx(idx);
              if (idx > 0) setBgRevealed(true);
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
    <div className={`deck-view deck-view-v8 deck-view-v9 active${bgRevealed ? ' deck-v8-bg-revealed' : ''}`} ref={containerRef}>
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
              if (slides && slides[idx]) {
                slides[idx].scrollIntoView({ behavior: 'smooth' });
              }
            }}
          >
            <span className="deck-v9-nav-dot-mark" />
            <span className="deck-v9-nav-dot-label">{title}</span>
          </button>
        ))}
      </nav>

      {/* Slide 1: Cover */}
      <div className="deck-slide deck-cover deck-v8-cover-intro">
        <CatalogLogo className="deck-logo deck-v8-cover-logo" />
        <p className="deck-subtitle">Investor Deck V.9 for Alex and Dan</p>
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
          <span className="deck-label deck-v8-reveal deck-v8-reveal-1">The Dream</span>
          <h2 className="deck-v8-reveal deck-v8-reveal-2">Discovery for all commerce.<br />Powered by creators.</h2>
        </div>
      </div>

      {/* Slide 3: The Problem: split layout with stakeholders stacked right */}
      <div className="deck-slide deck-v8-problem deck-v9-problem-slide">
        <div className="deck-v8-split-left">
          <span className="deck-label">The Problem</span>
          <h2>Three stakeholders.<br />Three broken experiences.</h2>
        </div>
        <div className="deck-v8-split-right">
          {[
            { num: '01', role: 'Shoppers', word: 'Discovery.', sub: 'Fragmented, ad-heavy, impersonal.' },
            { num: '02', role: 'Creators', word: 'Revenue.', sub: 'Single-digit commissions, no audience ownership.' },
            { num: '03', role: 'Brands', word: 'ROAS.', sub: 'Opaque attribution, no commerce outcomes.' },
          ].map(({ num, role, word, sub }) => (
            <div key={num} className="deck-v8-problem-item deck-v9-problem-item">
              <div className="deck-v9-problem-body">
                <div className="deck-v9-problem-headline">
                  <span className="deck-v9-problem-role">{role}</span>
                  <span className="deck-v9-problem-num">{num}</span>
                </div>
                <div className="deck-v9-problem-pain">
                  <svg className="deck-v8-broken-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle className="broken-circle" cx="12" cy="12" r="10" />
                    <line className="broken-x broken-x-1" x1="8.5" y1="8.5" x2="15.5" y2="15.5" />
                    <line className="broken-x broken-x-2" x1="15.5" y1="8.5" x2="8.5" y2="15.5" />
                  </svg>
                  <h3>{word}</h3>
                </div>
                <p>{sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Slide 4: The Solution - inverse of Problem, split layout with checkmarks */}
      <div className="deck-slide deck-v8-problem deck-v8-wins deck-v9-problem-slide">
        <div className="deck-v8-split-left">
          <span className="deck-label">The Solution</span>
          <h2>Human taste,<br />amplified by AI.<br />Everyone wins.</h2>
        </div>
        <div className="deck-v8-split-right">
          {[
            { num: '01', role: 'For Shoppers', word: 'Discovery.', sub: 'Curated by people they trust. No ads, no noise.' },
            { num: '02', role: 'For Creators', word: 'Revenue.', sub: 'Real commissions, audience ownership, paid in days.' },
            { num: '03', role: 'For Brands',   word: 'ROAS.',     sub: 'Clean attribution and guaranteed commerce outcomes.' },
          ].map(({ num, role, word, sub }) => (
            <div key={num} className="deck-v8-problem-item deck-v9-problem-item">
              <div className="deck-v9-problem-body">
                <div className="deck-v9-problem-headline">
                  <span className="deck-v9-problem-role">{role}</span>
                  <span className="deck-v9-problem-num">{num}</span>
                </div>
                <div className="deck-v9-problem-pain">
                  <svg className="deck-v8-win-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle className="win-circle" cx="12" cy="12" r="10" />
                    <polyline className="win-check" points="7.5 12.5 10.5 15.5 16.5 9" />
                  </svg>
                  <h3>{word}</h3>
                </div>
                <p>{sub}</p>
              </div>
            </div>
          ))}
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
              sourceUrl: 'https://www.grandviewresearch.com/industry-analysis/social-commerce-market',
            },
            {
              key: 'creator',
              value: '$1.1T',
              label: 'Creator-driven commerce by 2035',
              growth: '+22% CAGR',
              points: '20,116 42,108 64,98 85,88 107,76 129,64 150,54 172,44 194,36 216,30 238,24 260,20',
              source: 'Goldman Sachs, 2023',
              sourceUrl: 'https://www.goldmansachs.com/insights/articles/the-creator-economy-could-approach-half-a-trillion-dollars-by-2027',
            },
            {
              key: 'trust',
              value: '94%',
              label: 'Shoppers trust creators over ads by 2035',
              growth: '+12% YoY',
              points: '20,108 42,100 64,92 85,82 107,72 129,62 150,54 172,46 194,38 216,30 238,24 260,20',
              source: 'Matter Communications, 2024',
              sourceUrl: 'https://www.matternow.com/blog/new-consumer-survey-81-increase-their-trust-in-brand-through-influencer-marketing/',
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
                      style={{ '--dot-delay': `${2.5 + i * 0.75}s` } as React.CSSProperties}
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
                <p className="deck-v8-market-source-wrap">
                  <a
                    className="deck-v8-market-source"
                    href={chart.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Source: {chart.source}
                  </a>
                </p>
              </div>
            );
          })}
        </div>
        <p className="deck-note deck-v8-market-note">Catalog is the commerce layer connecting creators directly to purchase.</p>
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
          <table className="math-tbl deck-v8-math-tbl deck-v9-math-tbl">
          <thead>
            <tr>
              <th className="math-tbl-label"></th>
              <th className="math-tbl-old">
                <span className="deck-v9-math-col-title">Traditional Affiliate</span>
                <span className="deck-v9-math-col-sub">Sales commission, paid only on attribution</span>
              </th>
              <th className="math-tbl-new">
                <span className="deck-v9-math-col-title">Catalog (Fixed ROAS)</span>
                <span className="deck-v9-math-col-sub">Ad spend, locks in a guaranteed sale</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="math-tbl-label">Cost type</td>
              <td className="math-val-dim"><MathXIcon />Variable, post-sale</td>
              <td className="math-val-new"><MathCheckIcon />Fixed, pre-paid media</td>
            </tr>
            <tr>
              <td className="math-tbl-label">Brand spend</td>
              <td className="math-val-old"><MathXIcon />$20<span className="math-pct">commission</span></td>
              <td className="math-val-new"><MathCheckIcon />$40<span className="math-pct">ad placement</span></td>
            </tr>
            <tr>
              <td className="math-tbl-label">Brand outcome</td>
              <td className="math-val-dim"><MathXIcon />Maybe a sale</td>
              <td className="math-val-new"><MathCheckIcon /><span className="fire-text">$200 sale, 5x guaranteed</span></td>
            </tr>
            <tr>
              <td className="math-tbl-label">Creator payout</td>
              <td className="math-val-old"><MathXIcon />$16</td>
              <td className="math-val-new"><MathCheckIcon />$20</td>
            </tr>
            <tr>
              <td className="math-tbl-label">Platform revenue</td>
              <td className="math-val-old"><MathXIcon />$4</td>
              <td className="math-val-new"><MathCheckIcon />$20</td>
            </tr>
            <tr>
              <td className="math-tbl-label">Attribution</td>
              <td className="math-val-dim"><MathXIcon />Last-click, lossy</td>
              <td className="math-val-new"><MathCheckIcon />Full-funnel, per-creator</td>
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
            {flywheelSteps.map(({ n, label, sub, icon }) => (
              <div
                key={n}
                className="flywheel-label-item"
                onMouseEnter={() => setActiveFlywheelStep(n)}
                onMouseLeave={() => setActiveFlywheelStep(null)}
              >
                <span className="fl-num">{icon}</span>
                <div className="fl-text">
                  <p className="fl-label">{label}</p>
                  <p className="fl-sub">{sub}</p>
                </div>
              </div>
            ))}
          </div>
          <p>Every rotation makes the next one cheaper as creators bring free distribution, sales teach the feed, and earnings pull top creators back in, accelerating the wheel.</p>
        </div>
        <div className="flywheel-right">
          <div className="flywheel-center">
            <svg className="flywheel-circle-svg" viewBox="0 0 300 300">
              <circle cx="150" cy="150" r="130" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="2" />
              <circle className="flywheel-orbit" cx="150" cy="150" r="130" fill="none" stroke="rgba(74,222,128,0.3)" strokeWidth="2" strokeDasharray="817" strokeDashoffset="817" strokeLinecap="round" />
            </svg>
            {flywheelSteps.map(({ n, angle, icon }) => (
              <div
                key={n}
                className="flywheel-node"
                style={{ '--angle': angle } as React.CSSProperties}
                onMouseEnter={() => setActiveFlywheelStep(n)}
                onMouseLeave={() => setActiveFlywheelStep(null)}
              >
                <span>{icon}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Slide 9: Technology - vector DB visual discovery demo */}
      <div className="deck-slide deck-v9-tech">
        <div className="deck-v9-tech-left">
          <span className="deck-label">Technology</span>
          <h2>Visual taste,<br />indexed by AI.</h2>
          <p className="deck-v9-tech-lede">
            Every look is encoded into a vector database. Composition, color, garment, mood &mdash; all become coordinates a model can reason about.
          </p>
          <ul className="deck-v9-tech-points">
            <li>
              <span className="deck-v9-tech-bullet" aria-hidden="true" />
              <div>
                <strong>Visual embeddings.</strong>
                <span>Each look becomes a 1024-dim vector capturing composition, garment, color, and mood.</span>
              </div>
            </li>
            <li>
              <span className="deck-v9-tech-bullet" aria-hidden="true" />
              <div>
                <strong>Nearest-neighbor search.</strong>
                <span>One tap surfaces the next five looks a shopper is most likely to love &mdash; in milliseconds.</span>
              </div>
            </li>
            <li>
              <span className="deck-v9-tech-bullet" aria-hidden="true" />
              <div>
                <strong>Discovery that compounds.</strong>
                <span>Every interaction sharpens the model. The feed gets smarter with every shopper.</span>
              </div>
            </li>
          </ul>
          <p className="deck-v9-tech-hint">{techActiveSeed === null ? 'Tap any look to see five visual neighbors.' : 'Tap another look to re-query the index.'}</p>
        </div>
        <div className="deck-v9-tech-right">
          <div className="deck-v9-tech-stage">
            {techVideos.map((src, i) => {
              const isSeed = techActiveSeed === i;
              const isFanned = techActiveSeed !== null;
              return (
                <button
                  key={`seed-${i}`}
                  type="button"
                  className={`deck-v9-tech-tile deck-v9-tech-seed${isSeed ? ' is-seed' : ''}${isFanned && !isSeed ? ' is-dim' : ''}`}
                  style={{ '--seed-i': i } as React.CSSProperties}
                  onClick={() => setTechActiveSeed(isSeed ? null : i)}
                  aria-label={`Query look ${i + 1}`}
                >
                  <video src={`${basePath}/${src}`} autoPlay loop muted playsInline />
                </button>
              );
            })}
            {techActiveSeed !== null && (
              <>
                <svg className="deck-v9-tech-rays" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  {[
                    { x: 32, y: 50 },
                    { x: 50, y: 50 },
                    { x: 68, y: 50 },
                    { x: 41, y: 82 },
                    { x: 59, y: 82 },
                  ].map(({ x, y }, n) => (
                    <line
                      key={n}
                      className="deck-v9-tech-ray"
                      x1="50"
                      y1="16"
                      x2={x}
                      y2={y}
                      style={{ '--ray-i': n } as React.CSSProperties}
                    />
                  ))}
                </svg>
                {[0, 1, 2, 3, 4].map((n) => {
                  const src = techVideos[(techActiveSeed + n + 1) % techVideos.length];
                  return (
                    <div
                      key={`neighbor-${techActiveSeed}-${n}`}
                      className="deck-v9-tech-tile deck-v9-tech-neighbor"
                      style={{ '--n-i': n } as React.CSSProperties}
                    >
                      <video src={`${basePath}/${src}`} autoPlay loop muted playsInline />
                      <span className="deck-v9-tech-neighbor-tag">0.9{9 - n}</span>
                    </div>
                  );
                })}
              </>
            )}
          </div>
          <div className="deck-v9-tech-meta">
            <span className="deck-v9-tech-meta-dot" />
            <span>Vector index &middot; cosine similarity &middot; ~12ms p99</span>
          </div>
        </div>
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
        <div className="deck-v8-traction-stats">
          <div className="deck-v8-traction-stat">
            <span className="deck-v8-traction-num">V1</span>
            <span className="deck-v8-traction-label">Product live and functional</span>
          </div>
          <div className="deck-v8-traction-stat">
            <span className="deck-v8-traction-num">42</span>
            <span className="deck-v8-traction-label">Active creators</span>
          </div>
          <div className="deck-v8-traction-stat">
            <span className="deck-v8-traction-num">318</span>
            <span className="deck-v8-traction-label">Looks published</span>
          </div>
          <div className="deck-v8-traction-stat">
            <span className="deck-v8-traction-num">12</span>
            <span className="deck-v8-traction-label">Brands integrated</span>
          </div>
        </div>
        <p className="deck-v8-traction-note">* Demo data. Live numbers updated as the beta scales.</p>
      </div>

      {/* Slide 11: The Ask */}
      <div className="deck-slide deck-v8-ask">
        <span className="deck-label">The Ask</span>
        <h2>Fuel the flywheel.</h2>

        <div className="deck-v8-ask-stage">
          <div className="deck-v8-ask-raise">
            <div className="deck-v8-ask-raise-card">
              <div className="deck-v8-ask-raise-row">
                <div className="deck-v8-ask-raise-item">
                  <span className="deck-v8-ask-raise-num">$2.5M</span>
                  <span className="deck-v8-ask-raise-label">Round size</span>
                </div>
                <div className="deck-v8-ask-raise-divider" aria-hidden="true" />
                <div className="deck-v8-ask-raise-item">
                  <span className="deck-v8-ask-raise-num">$12.5M</span>
                  <span className="deck-v8-ask-raise-label">SAFE cap</span>
                </div>
                <div className="deck-v8-ask-raise-divider" aria-hidden="true" />
                <div className="deck-v8-ask-raise-item">
                  <span className="deck-v8-ask-raise-num">Seed</span>
                  <span className="deck-v8-ask-raise-label">Stage</span>
                </div>
              </div>
              <p className="deck-v8-ask-raise-caption">Capital deployed across three priorities to ignite the flywheel.</p>
            </div>
          </div>

          <svg className="deck-v8-ask-flow" viewBox="0 0 1000 240" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="v8AskFlowGrad" gradientUnits="userSpaceOnUse" x1="0" y1="10" x2="0" y2="230">
                <stop offset="0%" stopColor="rgba(255,255,255,0.95)" />
                <stop offset="55%" stopColor="rgba(253,224,130,0.8)" />
                <stop offset="100%" stopColor="rgba(245,197,66,0.95)" />
              </linearGradient>
              <filter id="v8AskFlowGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2.8" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <path className="deck-v8-ask-flow-path deck-v8-ask-flow-path-1" pathLength="1" d="M 500 10 C 500 90, 170 100, 170 230" stroke="url(#v8AskFlowGrad)" strokeWidth="1.8" fill="none" filter="url(#v8AskFlowGlow)" strokeLinecap="round" />
            <path className="deck-v8-ask-flow-path deck-v8-ask-flow-path-2" pathLength="1" d="M 500 10 C 501 90, 499 150, 500 230" stroke="url(#v8AskFlowGrad)" strokeWidth="1.8" fill="none" filter="url(#v8AskFlowGlow)" strokeLinecap="round" />
            <path className="deck-v8-ask-flow-path deck-v8-ask-flow-path-3" pathLength="1" d="M 500 10 C 500 90, 830 100, 830 230" stroke="url(#v8AskFlowGrad)" strokeWidth="1.8" fill="none" filter="url(#v8AskFlowGlow)" strokeLinecap="round" />
            <circle className="deck-v8-ask-flow-dot deck-v8-ask-flow-dot-1" cx="170" cy="230" r="3.2" fill="#f5c542" filter="url(#v8AskFlowGlow)" />
            <circle className="deck-v8-ask-flow-dot deck-v8-ask-flow-dot-2" cx="500" cy="230" r="3.2" fill="#f5c542" filter="url(#v8AskFlowGlow)" />
            <circle className="deck-v8-ask-flow-dot deck-v8-ask-flow-dot-3" cx="830" cy="230" r="3.2" fill="#f5c542" filter="url(#v8AskFlowGlow)" />
          </svg>

          <div className="deck-v8-ask-priorities">
            <div className="deck-v8-ask-priority">
              <span className="deck-v8-ask-priority-num">01</span>
              <h3>Seed the creator side</h3>
              <p>Onboard the first wave of creators and build the content supply that drives organic demand and distribution.</p>
            </div>
            <div className="deck-v8-ask-priority">
              <span className="deck-v8-ask-priority-num">02</span>
              <h3>Deepen the product</h3>
              <p>Build product tagging infrastructure, native mobile app, and creator analytics that make Catalog the default tool.</p>
            </div>
            <div className="deck-v8-ask-priority">
              <span className="deck-v8-ask-priority-num">03</span>
              <h3>Bring brands on board</h3>
              <p>Launch the fixed-ROAS model with early brand partners and prove the economics that make the marketplace self-sustaining.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Slide 12: Roadmap timeline */}
      <div className="deck-slide deck-v8-roadmap">
        <span className="deck-label">Roadmap</span>
        <h2>16 months to commerce gravity.</h2>

        <div className="deck-v8-roadmap-card">
          <div className="deck-v8-roadmap-card-header">Timeline overview</div>

          <div className="deck-v8-roadmap-rows">
            {roadmapPhases.map((phase, idx) => {
              const leftPct = (phase.start / 16) * 100;
              const widthPct = ((phase.end - phase.start) / 16) * 100;
              const months = phase.end - phase.start;
              return (
                <div key={phase.label} className="deck-v8-roadmap-row" style={{ ['--row-delay' as string]: `${1.0 + idx * 0.12}s` }}>
                  <div className="deck-v8-roadmap-rowlabel">
                    <span className="deck-v8-roadmap-rowlabel-title">{phase.label}</span>
                    <span className="deck-v8-roadmap-rowlabel-sub">{phase.sub}</span>
                  </div>
                  <div className="deck-v8-roadmap-track">
                    <div
                      className="deck-v8-roadmap-bar"
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        background: phase.color,
                        boxShadow: `0 0 24px ${phase.color}33`,
                      }}
                    >
                      <span className="deck-v8-roadmap-bar-label">{months}mo</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="deck-v8-roadmap-axis">
            <span>Month 0</span>
            <span>Month 4</span>
            <span>Month 8</span>
            <span>Month 12</span>
            <span>Month 16</span>
          </div>
        </div>

        <p className="deck-v8-roadmap-note">A focused 16-month plan to ignite supply, prove demand, and lock the fixed-ROAS economics.</p>
      </div>

      {/* Slide 13: Final */}
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

export default DeckViewV9;
