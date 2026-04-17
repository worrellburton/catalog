
import React, { useEffect, useRef, useState } from 'react';
import CatalogLogo from './CatalogLogo';

interface DeckViewV1Props {
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

/* 16-month roadmap phases. Hire Directors and Test run as parallel support tracks.
   start/end are months (0..16). Bars render proportionally over a 16-month track.
   These are the initial values — the user can drag to reposition/resize at runtime. */
type RoadmapPhase = { label: string; sub: string; start: number; end: number; color: string; parallel?: boolean };
const initialRoadmapPhases: RoadmapPhase[] = [
  { label: 'Hire Directors',           sub: 'Staff leadership across seed, Shopify, and creator onboarding.',               start: 0,  end: 3,  color: '#f5c542', parallel: true },
  { label: 'Seed Product with AI',     sub: 'AI-generated imagery and video linked to brand stores, fully automated.',      start: 0,  end: 2,  color: '#a78bfa' },
  { label: 'Shopify Integration',      sub: 'Ship the Shopify App: self-serve onboarding, product sync, attribution.',      start: 1,  end: 2,  color: '#fb923c' },
  { label: 'Onboard First Creators',   sub: 'Invite-only cohort, beta storefronts, early feedback loops.',                  start: 2,  end: 5,  color: '#38bdf8' },
  { label: 'Test',                     sub: 'Iterate discovery, payouts, and attribution against real sales.',              start: 2,  end: 5,  color: '#34d399', parallel: true },
  { label: 'Start GTM 1.0',            sub: 'First public motion \u2014 creators, shoppers, and brand acquisition.',       start: 5,  end: 9,  color: '#f97316' },
  { label: 'Learn GTM',                sub: 'Tighten CAC, ROAS, and retention signals before scaling.',                     start: 9,  end: 13, color: '#fde047' },
  { label: 'Start GTM 2.1',            sub: 'Scaled go-to-market with proven economics and category expansion.',            start: 13, end: 16, color: '#f43f5e' },
];

const DeckViewV1: React.FC<DeckViewV1Props> = ({
  onSeeApp,
  onVisitWebsite,
  onBack,
  isLightMode,
  onToggleTheme,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const [activeFlywheelStep, setActiveFlywheelStep] = useState<number | null>(null);
  const [flywheelView, setFlywheelView] = useState<'seed' | 'wheel'>('seed');
  const [bgRevealed, setBgRevealed] = useState(false);
  const [techActiveSeed] = useState<number | null>(0);
  const techVideos = ['girl2.mp4', 'guy.mp4', 'Untitled.mp4', 'girl.mp4', 'qm1navb8bjo8fjlgjs5x.mp4'];
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [roadmapPhases, setRoadmapPhases] = useState<RoadmapPhase[]>(initialRoadmapPhases);
  const roadmapTrackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ idx: number; mode: 'move' | 'left' | 'right'; startX: number; start0: number; end0: number } | null>(null);

  const onBarPointerDown = (e: React.PointerEvent<HTMLElement>, idx: number, mode: 'move' | 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();
    const phase = roadmapPhases[idx];
    dragRef.current = { idx, mode, startX: e.clientX, start0: phase.start, end0: phase.end };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onBarPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || !roadmapTrackRef.current) return;
    const rect = roadmapTrackRef.current.getBoundingClientRect();
    if (rect.width === 0) return;
    const monthsPerPx = 16 / rect.width;
    const delta = Math.round((e.clientX - drag.startX) * monthsPerPx);
    setRoadmapPhases((prev) =>
      prev.map((p, i) => {
        if (i !== drag.idx) return p;
        const duration = drag.end0 - drag.start0;
        if (drag.mode === 'move') {
          const newStart = Math.max(0, Math.min(16 - duration, drag.start0 + delta));
          return { ...p, start: newStart, end: newStart + duration };
        } else if (drag.mode === 'left') {
          const newStart = Math.max(0, Math.min(drag.end0 - 1, drag.start0 + delta));
          return { ...p, start: newStart };
        } else {
          const newEnd = Math.max(drag.start0 + 1, Math.min(16, drag.end0 + delta));
          return { ...p, end: newEnd };
        }
      })
    );
  };

  const onBarPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (dragRef.current) {
      dragRef.current = null;
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
    }
  };
  const slideTitles = [
    'Cover',
    'The Dream',
    'The Problem',
    'The Solution',
    'Market Opportunity',
    'The Math',
    'Flywheel',
    'Technology',
    'Payouts',
    'Traction',
    'Roadmap',
    'The Ask',
    'Closing',
  ];

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const slides = container.querySelectorAll('.deck-slide');

    const hash = window.location.hash.replace('#', '');
    const slideMatch = hash.match(/^deck\/v1\/(\d+)$/);
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
              window.history.replaceState(null, '', `#deck/v1/${idx + 1}`);
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
    <div className={`deck-view deck-view-v8 deck-view-v9 deck-view-v1 active${bgRevealed ? ' deck-v8-bg-revealed' : ''}`} ref={containerRef}>
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
        <p className="deck-subtitle">Investor Deck V.1 for Alex and Dan</p>
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
          <h2 className="deck-v8-reveal deck-v8-reveal-2 deck-v1-dream-h2">Discovery for all commerce.<br />Human taste. Superpowered by AI.</h2>
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
            { num: '02', role: 'Creators', word: 'Revenue.', sub: 'Single-digit commissions, disorganized and hard.' },
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
          <h2>Creators curate.<br />AI indexes.<br />Everyone wins.</h2>
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
                <span className="deck-v1-math-budget deck-v1-math-budget-old">Sales expense &middot; Cost of sale</span>
                <span className="deck-v9-math-col-title">Traditional Affiliate</span>
                <span className="deck-v9-math-col-sub">Sales commission, paid only on attribution</span>
              </th>
              <th className="math-tbl-new">
                <span className="deck-v1-math-budget deck-v1-math-budget-new">Advertising &middot; Marketing budget</span>
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

      {/* Slide 9: Flywheel — Seed ↔ Creator Flywheel with slide animation */}
      <div
        className={`deck-slide deck-slide-flywheel-split deck-v1-flywheel-slide flywheel-view-${flywheelView}`}
        data-active-step={activeFlywheelStep ?? undefined}
      >
        {/* Seed view */}
        <div className="deck-v1-fw-view deck-v1-fw-view-seed" aria-hidden={flywheelView !== 'seed'}>
          <div className="flywheel-left">
            <span className="deck-label">Step Zero</span>
            <h2>Build and seed product.</h2>
            <div className="deck-v1-seed-steps">
              <div className="deck-v1-seed-step">
                <span className="deck-v1-seed-step-num">01</span>
                <p><strong>Build AI Agent scrapers.</strong> Autonomous agents crawl brand stores and pull product data, imagery, and pricing in real time.</p>
              </div>
              <div className="deck-v1-seed-step">
                <span className="deck-v1-seed-step-num">02</span>
                <p><strong>Auto brand products to AI creative.</strong> Static product shots are automatically transformed into editorial imagery and short-form video.</p>
              </div>
              <div className="deck-v1-seed-step">
                <span className="deck-v1-seed-step-num">03</span>
                <p><strong>Index elegantly.</strong> Every look is vectorised and indexed &mdash; ready for the feed before a single creator arrives.</p>
              </div>
            </div>
            <p>Catalog launches with inventory built in &mdash; no cold start. The creator flywheel compounds on top.</p>
          </div>
          <div className="flywheel-right">
            <div className="deck-v1-seed-pipeline">
              <div className="deck-v1-seed-pipeline-stage">
                <div className="deck-v1-seed-pipeline-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 9h.01M15 9h.01M9 15h6" /></svg>
                </div>
                <span className="deck-v1-seed-pipeline-label">AI Agent scrapers</span>
                <span className="deck-v1-seed-pipeline-hint">Autonomous data collection</span>
              </div>
              <div className="deck-v1-seed-pipeline-flow" aria-hidden="true">
                <span className="deck-v1-seed-pipeline-dot" />
                <span className="deck-v1-seed-pipeline-dot" style={{ animationDelay: '0.8s' }} />
                <span className="deck-v1-seed-pipeline-dot" style={{ animationDelay: '1.6s' }} />
              </div>
              <div className="deck-v1-seed-pipeline-stage">
                <div className="deck-v1-seed-pipeline-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.5 4.5H18l-3.5 2.5L16 14.5 12 11.5 8 14.5l1.5-4.5L6 7.5h4.5z" /><rect x="3" y="17" width="18" height="4" rx="1" /></svg>
                </div>
                <span className="deck-v1-seed-pipeline-label">AI creative</span>
                <span className="deck-v1-seed-pipeline-hint">Auto-generate from brand products</span>
              </div>
              <div className="deck-v1-seed-pipeline-flow" aria-hidden="true">
                <span className="deck-v1-seed-pipeline-dot" style={{ animationDelay: '0.4s' }} />
                <span className="deck-v1-seed-pipeline-dot" style={{ animationDelay: '1.2s' }} />
                <span className="deck-v1-seed-pipeline-dot" style={{ animationDelay: '2.0s' }} />
              </div>
              <div className="deck-v1-seed-pipeline-stage deck-v1-seed-pipeline-stage-terminal">
                <div className="deck-v1-seed-pipeline-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
                </div>
                <span className="deck-v1-seed-pipeline-label">Indexed elegantly</span>
                <span className="deck-v1-seed-pipeline-hint">Vector DB &middot; ready for feed</span>
              </div>
            </div>
          </div>
          <button
            className="deck-v1-flywheel-nav deck-v1-flywheel-nav-right"
            type="button"
            onClick={() => setFlywheelView('wheel')}
            aria-label="See the creator flywheel"
            tabIndex={flywheelView === 'seed' ? 0 : -1}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        </div>

        {/* Wheel view */}
        <div className="deck-v1-fw-view deck-v1-fw-view-wheel" aria-hidden={flywheelView !== 'wheel'}>
          <button
            className="deck-v1-flywheel-nav deck-v1-flywheel-nav-left"
            type="button"
            onClick={() => setFlywheelView('seed')}
            aria-label="Back to product seeding"
            tabIndex={flywheelView === 'wheel' ? 0 : -1}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div className="flywheel-left">
            <span className="deck-label">Creator Flywheel</span>
            <h2>Build supply first.<br />Demand follows trust.</h2>
            <div className="flywheel-labels">
              {flywheelSteps.map(({ n, label, icon }) => (
                <div
                  key={n}
                  className="flywheel-label-item"
                  onMouseEnter={() => setActiveFlywheelStep(n)}
                  onMouseLeave={() => setActiveFlywheelStep(null)}
                >
                  <span className="fl-num">{icon}</span>
                  <div className="fl-text">
                    <p className="fl-label">{label}</p>
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
          <p className="deck-v9-tech-hint">Every look finds its five nearest visual neighbors automatically.</p>
        </div>
        <div className="deck-v9-tech-right">
          <div className="deck-v1-tech-stage" key={`tech-${techActiveSeed}`}>
            {/* 1 seed creative at top */}
            <div className="deck-v1-tech-seed">
              <video src={`${basePath}/${techVideos[techActiveSeed ?? 0]}`} autoPlay loop muted playsInline />
            </div>
            {/* 5 rays spawning down to 5 new creatives */}
            <svg className="deck-v1-tech-rays" viewBox="0 0 600 260" preserveAspectRatio="none" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((n) => {
                const x2 = 60 + n * 120;
                return (
                  <line
                    key={`ray-${techActiveSeed}-${n}`}
                    className="deck-v1-tech-ray"
                    x1="300" y1="8" x2={x2} y2="240"
                    style={{ '--ray-i': n } as React.CSSProperties}
                  />
                );
              })}
            </svg>
            {/* 5 spawned creatives at bottom */}
            <div className="deck-v1-tech-neighbors">
              {[0, 1, 2, 3, 4].map((n) => {
                const src = techVideos[((techActiveSeed ?? 0) + n + 1) % techVideos.length];
                return (
                  <div
                    key={`neighbor-${techActiveSeed}-${n}`}
                    className="deck-v1-tech-neighbor"
                    style={{ '--n-i': n } as React.CSSProperties}
                  >
                    <video src={`${basePath}/${src}`} autoPlay loop muted playsInline />
                    <span className="deck-v1-tech-neighbor-tag">0.9{9 - n}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="deck-v9-tech-meta">
            <span className="deck-v9-tech-meta-dot" />
            <span>Vector index &middot; cosine similarity &middot; ~12ms p99</span>
          </div>
        </div>
      </div>

      {/* Slide 10: Payouts — how creators earn across four streams */}
      <div className="deck-slide deck-v1-payouts">
        <div className="deck-v1-payouts-inner">
          <div className="deck-v1-payouts-header">
            <span className="deck-label">Payouts</span>
            <h2>Post once.<br />Earn four ways.</h2>
            <p className="deck-v1-payouts-subtitle">Post authentically, earn daily.</p>
          </div>

          <div className="deck-v1-payouts-body deck-v1-payouts-radial">
            <div className="deck-v1-payouts-card deck-v1-payouts-card-tl">
              <div className="deck-v1-payouts-card-head">
                <span className="deck-v1-payouts-num">01</span>
                <h3>Engagement</h3>
                <span className="deck-v1-payouts-chip">Daily payouts</span>
              </div>
              <p>Every click is valuable. Share of total platform clicks equals share of the daily payout pool. Like YouTube&rsquo;s ad-revenue model &mdash; paid out daily.</p>
            </div>
            <div className="deck-v1-payouts-card deck-v1-payouts-card-tr">
              <div className="deck-v1-payouts-card-head">
                <span className="deck-v1-payouts-num">02</span>
                <h3>Affiliate links</h3>
                <span className="deck-v1-payouts-chip">Pass-through</span>
              </div>
              <p>Full commissions on sales driven through a creator's own affiliate links &mdash; transparent and fast.</p>
            </div>
            <div className="deck-v1-payouts-card deck-v1-payouts-card-bl">
              <div className="deck-v1-payouts-card-head">
                <span className="deck-v1-payouts-num">03</span>
                <h3>Catalog sales</h3>
                <span className="deck-v1-payouts-chip">Rev share</span>
              </div>
              <p>Revenue share on every Catalog-attributed sale driven by a creator's look. Direct, no shared pool.</p>
            </div>
            <div className="deck-v1-payouts-card deck-v1-payouts-card-br">
              <div className="deck-v1-payouts-card-head">
                <span className="deck-v1-payouts-num">04</span>
                <h3>Referrals</h3>
                <span className="deck-v1-payouts-chip">Lifetime</span>
              </div>
              <p>Bringing new shoppers onto Catalog earns ongoing rev-share on the sales those users make.</p>
            </div>

            <svg className="deck-v1-payouts-flows" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">
              <path className="deck-v1-pay-line deck-v1-pay-line-1" d="M 260 140 Q 400 260 500 300" fill="none" stroke="#4ade80" strokeWidth="1.5" strokeDasharray="6 6" />
              <path className="deck-v1-pay-line deck-v1-pay-line-2" d="M 740 140 Q 600 260 500 300" fill="none" stroke="#4ade80" strokeWidth="1.5" strokeDasharray="6 6" />
              <path className="deck-v1-pay-line deck-v1-pay-line-3" d="M 260 460 Q 400 340 500 300" fill="none" stroke="#4ade80" strokeWidth="1.5" strokeDasharray="6 6" />
              <path className="deck-v1-pay-line deck-v1-pay-line-4" d="M 740 460 Q 600 340 500 300" fill="none" stroke="#4ade80" strokeWidth="1.5" strokeDasharray="6 6" />
            </svg>

            <div className="deck-v1-payouts-center" aria-hidden="true">
              <svg className="deck-v1-payouts-creator" viewBox="0 0 107 107">
                <defs>
                  <radialGradient id="v1CreatorBg" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="rgba(74,222,128,0.25)" />
                    <stop offset="100%" stopColor="rgba(74,222,128,0)" />
                  </radialGradient>
                </defs>
                <circle cx="53.5" cy="53.5" r="53" fill="url(#v1CreatorBg)" />
                <path d="M54.0845 6.5C53.7766 6.5 53.4687 6.5 53.1515 6.5C40.7788 6.5 28.9129 11.4151 20.1641 20.1639C11.4153 28.9128 6.5001 40.7787 6.5001 53.1514C6.4873 59.3614 7.7193 65.511 10.1231 71.2368C12.5269 76.9627 16.0537 82.1487 20.4955 86.4886C29.2082 95.0456 40.9395 99.8286 53.1515 99.8029C65.3635 99.8286 77.0948 95.0456 85.8075 86.4886C90.2493 82.1487 93.7761 76.9627 96.1799 71.2368C98.5837 65.511 99.8157 59.3614 99.8029 53.1514C99.8029 52.7782 99.8029 52.4143 99.8029 52.0411" stroke="#4ade80" strokeWidth="9" strokeLinecap="square" strokeLinejoin="round" fill="none" />
                <path d="M26.1079 88.7464C27.2103 82.1192 30.6287 76.0981 35.7544 71.7549C40.8801 67.4118 47.3805 65.0283 54.0988 65.0288C60.8171 65.0283 67.3175 67.4118 72.4432 71.7549C77.5689 76.0981 80.9873 82.1192 82.0897 88.7464" stroke="#4ade80" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                <path d="M53.8274 64.1333C62.639 64.1333 69.7822 56.99 69.7822 48.1784C69.7822 39.3668 62.639 32.2236 53.8274 32.2236C45.0158 32.2236 37.8726 39.3668 37.8726 48.1784C37.8726 56.99 45.0158 64.1333 53.8274 64.1333Z" stroke="#4ade80" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                <path d="M89.5453 27.1831L80.1952 32.0835C80.0945 32.1374 79.9804 32.162 79.8661 32.1544C79.7518 32.1468 79.6421 32.1074 79.5496 32.0407C79.4571 31.974 79.3854 31.8827 79.3434 31.7775C79.3013 31.6724 79.2903 31.5576 79.3116 31.4464L81.0983 21.1555C81.1127 21.0596 81.1042 20.9618 81.0731 20.8698C81.0421 20.7779 80.9895 20.6944 80.9197 20.6263L73.3461 13.3442C73.2661 13.265 73.21 13.1656 73.1835 13.0568C73.1571 12.948 73.1615 12.8342 73.1964 12.7278C73.2313 12.6214 73.2953 12.5265 73.3813 12.4537C73.4673 12.3809 73.5719 12.3329 73.6837 12.3151L84.1456 10.8058C84.2446 10.7947 84.3392 10.7592 84.4207 10.7027C84.5022 10.6462 84.568 10.5705 84.6121 10.4823L89.2872 1.1225C89.3366 1.02089 89.414 0.935117 89.5106 0.875086C89.6072 0.815055 89.719 0.783203 89.8332 0.783203C89.9473 0.783203 90.0591 0.815055 90.1557 0.875086C90.2523 0.935117 90.3298 1.02089 90.3791 1.1225L95.0542 10.4823C95.0984 10.5705 95.1641 10.6462 95.2456 10.7027C95.3271 10.7592 95.4217 10.7947 95.5207 10.8058L105.983 12.3151C106.094 12.3329 106.199 12.3809 106.285 12.4537C106.371 12.5265 106.435 12.6214 106.47 12.7278C106.505 12.8342 106.509 12.948 106.483 13.0568C106.456 13.1656 106.4 13.265 106.32 13.3442L98.7466 20.6263C98.6769 20.6944 98.6243 20.7779 98.5932 20.8698C98.5622 20.9618 98.5536 21.0596 98.568 21.1555L100.355 31.4464C100.376 31.5576 100.365 31.6724 100.323 31.7775C100.281 31.8827 100.209 31.974 100.117 32.0407C100.024 32.1074 99.9146 32.1468 99.8003 32.1544C99.686 32.162 99.5719 32.1374 99.4712 32.0835L90.1211 27.1831C90.0314 27.1398 89.9329 27.1172 89.8332 27.1172C89.7334 27.1172 89.6349 27.1398 89.5453 27.1831Z" fill="#4ade80"/>
              </svg>
            </div>

          </div>
        </div>
      </div>

      {/* Slide 11: Traction */}
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

      {/* Slide 11: Roadmap timeline */}
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
                <div key={phase.label} className={`deck-v8-roadmap-row${phase.parallel ? ' deck-v1-roadmap-row-parallel' : ''}`} style={{ ['--row-delay' as string]: `${1.0 + idx * 0.12}s` }}>
                  <div className="deck-v8-roadmap-rowlabel">
                    <span className="deck-v8-roadmap-rowlabel-title">
                      {phase.label}
                      {phase.parallel && <span className="deck-v1-roadmap-parallel-tag">Parallel</span>}
                    </span>
                    <span className="deck-v8-roadmap-rowlabel-sub">{phase.sub}</span>
                  </div>
                  <div className="deck-v8-roadmap-track" ref={idx === 0 ? roadmapTrackRef : undefined}>
                    <div
                      className={`deck-v8-roadmap-bar deck-v1-roadmap-bar-draggable${phase.parallel ? ' deck-v1-roadmap-bar-parallel' : ''}`}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        background: phase.parallel ? 'transparent' : phase.color,
                        borderColor: phase.parallel ? phase.color : undefined,
                        boxShadow: phase.parallel ? 'none' : `0 0 24px ${phase.color}33`,
                      } as React.CSSProperties}
                      onPointerDown={(e) => onBarPointerDown(e, idx, 'move')}
                      onPointerMove={onBarPointerMove}
                      onPointerUp={onBarPointerUp}
                      onPointerCancel={onBarPointerUp}
                      title="Drag to move. Drag edges to resize."
                    >
                      <span
                        className="deck-v1-roadmap-handle deck-v1-roadmap-handle-left"
                        onPointerDown={(e) => onBarPointerDown(e, idx, 'left')}
                        onPointerMove={onBarPointerMove}
                        onPointerUp={onBarPointerUp}
                        onPointerCancel={onBarPointerUp}
                        aria-hidden="true"
                      />
                      <span className="deck-v8-roadmap-bar-label" style={phase.parallel ? { color: phase.color } : undefined}>{months}mo</span>
                      <span
                        className="deck-v1-roadmap-handle deck-v1-roadmap-handle-right"
                        onPointerDown={(e) => onBarPointerDown(e, idx, 'right')}
                        onPointerMove={onBarPointerMove}
                        onPointerUp={onBarPointerUp}
                        onPointerCancel={onBarPointerUp}
                        aria-hidden="true"
                      />
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

      {/* Slide 12: The Ask */}
      <div className="deck-slide deck-v8-ask">
        <span className="deck-label">The Ask</span>
        <h2>Build the future.<br />Fuel the flywheel.</h2>

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

export default DeckViewV1;
