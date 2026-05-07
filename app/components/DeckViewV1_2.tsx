
import React, { useEffect, useMemo, useRef, useState } from 'react';
import CatalogLogo from './CatalogLogo';
import ProjectionsChart from './ProjectionsChart';
import { getHomeFeed, type ProductAd } from '~/services/product-creative';
import {
  type Assumptions,
  buildSeries,
  fmtCurrency,
  fmtPercent,
  readStored as readProjections,
  summarize,
  MONTHS as PROJ_MONTHS,
} from '~/services/projections';

interface DeckViewV1_2Props {
  onSeeApp: () => void;
  onVisitWebsite: () => void;
  onBack: () => void;
  isLightMode: boolean;
  onToggleTheme: () => void;
}

/*
 * MathPhases - the rebuilt "The Math" slide.
 *
 * 10 progressively revealed phases walk the viewer from a single $200 sale
 * to a $6T-TAM picture. Phases auto-advance (12s each) with a fill bar, and
 * can be clicked ahead/back at any time. The component only runs its timer
 * while the slide is actually visible - we pause when scrolled away to keep
 * bandwidth / re-renders low.
 *
 * Numbers here are deliberately traceable: commission rates come from the
 * 18-network survey in /admin/affiliate (5–25% range across Impact, Rakuten,
 * CJ, ShareASale, Awin, LTK, Skimlinks, etc.). Funnel conversion uses
 * industry-standard social-commerce benchmarks (3% CTR, 3% click→buy) on a
 * $150 AOV. User growth is directional, not a forecast.
 */

function RevenueChart() {
  // Lightweight inline SVG - no dep, no layout jank. Values are ARR in $M.
  const bars: { label: string; value: number; color: string }[] = [
    { label: 'Y1',  value: 2.3,    color: '#38bdf8' },
    { label: 'Y2',  value: 22.5,   color: '#a78bfa' },
    { label: 'Y3',  value: 225,    color: '#f5c542' },
    { label: 'Y5',  value: 2250,   color: '#f43f5e' },
  ];
  const W = 520;
  const H = 220;
  const PAD_L = 48;
  const PAD_B = 34;
  const PAD_T = 16;
  const innerW = W - PAD_L - 16;
  const innerH = H - PAD_B - PAD_T;
  const max = Math.log10(bars[bars.length - 1].value) + 0.3;
  const yScale = (v: number) => innerH - (Math.log10(v) / max) * innerH;
  const barW = innerW / bars.length - 18;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="math-chart" aria-label="Platform ARR projection chart">
      {/* Grid lines at log steps */}
      {[1, 10, 100, 1000].map((g, i) => (
        <g key={i}>
          <line
            x1={PAD_L}
            y1={PAD_T + yScale(g)}
            x2={W - 16}
            y2={PAD_T + yScale(g)}
            stroke="rgba(255,255,255,0.08)"
            strokeDasharray="2 3"
          />
          <text
            x={PAD_L - 8}
            y={PAD_T + yScale(g) + 4}
            textAnchor="end"
            fontSize="10"
            fill="rgba(255,255,255,0.45)"
          >
            ${g >= 1000 ? `${g / 1000}B` : `${g}M`}
          </text>
        </g>
      ))}
      {/* Bars */}
      {bars.map((b, i) => {
        const x = PAD_L + 9 + i * (innerW / bars.length);
        const y = PAD_T + yScale(b.value);
        const h = innerH - yScale(b.value);
        return (
          <g key={b.label} className="math-chart-bar" style={{ animationDelay: `${i * 140}ms` }}>
            <rect x={x} y={y} width={barW} height={h} fill={b.color} rx="2" />
            <text
              x={x + barW / 2}
              y={y - 6}
              textAnchor="middle"
              fontSize="11"
              fontWeight="700"
              fill={b.color}
            >
              ${b.value >= 1000 ? `${(b.value / 1000).toFixed(2)}B` : `${b.value}M`}
            </text>
            <text
              x={x + barW / 2}
              y={H - 12}
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              fill="rgba(255,255,255,0.7)"
            >
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}


// All 10 beats rendered on a single slide: top headline, commission
// compare, funnel, creator/user/token stat strip, ARR chart, growth row,
// TAM + flywheel close. No timers, no carousel - everything visible at once.
function MathPhases() {
  return (
    <div className="math-phases math-phases-static">
      <div className="math-band math-band-scenario">
        <div>
          <span className="math-phase-kicker">Scenario</span>
          <h3 className="math-phase-title">Start with one $200 sale.</h3>
          <p className="math-phase-lede">Every number below stacks on one shopper, one creator, one cart.</p>
        </div>
        <div className="math-stat-row">
          <div className="math-stat"><span className="math-stat-value">1</span><span className="math-stat-label">creator</span></div>
          <div className="math-stat"><span className="math-stat-value">1</span><span className="math-stat-label">shopper</span></div>
          <div className="math-stat"><span className="math-stat-value">$200</span><span className="math-stat-label">cart</span></div>
        </div>
      </div>

      <div className="math-band">
        <span className="math-phase-kicker">Commission</span>
        <h3 className="math-phase-title">Retail norm 5–10%. Catalog negotiates 15–25%.</h3>
        <p className="math-phase-lede">Surveyed across 18 networks - Impact, Rakuten, CJ, ShareASale, Awin, LTK, Skimlinks, Pepperjam, Refersion, Howl, MagicLinks and more. Because Catalog owns the commerce surface, we take direct creator-first terms.</p>
        <div className="math-compare">
          <div className="math-compare-col math-compare-old">
            <span className="math-compare-label">Legacy networks</span>
            <span className="math-compare-value">5–10%</span>
            <span className="math-compare-sub">retail norm · last-click · leaky</span>
          </div>
          <div className="math-compare-col math-compare-new">
            <span className="math-compare-label">Catalog direct</span>
            <span className="math-compare-value">15–25%</span>
            <span className="math-compare-sub">creator-first · first-party attribution</span>
          </div>
        </div>
      </div>

      <div className="math-band">
        <span className="math-phase-kicker">Funnel</span>
        <h3 className="math-phase-title">1,000 impressions → 0.9 sales → ~$20 RPM.</h3>
        <p className="math-phase-lede">Social-commerce benchmarks plug into the feed: 3% CTR, 3% click-to-buy, $150 AOV, 15% blended commission. At the top of the shoppable-video league.</p>
        <div className="math-funnel">
          <div className="math-funnel-step"><span>1,000</span> impressions</div>
          <div className="math-funnel-arrow">→</div>
          <div className="math-funnel-step"><span>30</span> clicks · 3% CTR</div>
          <div className="math-funnel-arrow">→</div>
          <div className="math-funnel-step"><span>0.9</span> sales · 3% conv</div>
          <div className="math-funnel-arrow">→</div>
          <div className="math-funnel-step math-funnel-out"><span>$20</span> RPM</div>
        </div>
      </div>

      <div className="math-band math-band-three">
        <div className="math-subband">
          <span className="math-phase-kicker">Creator</span>
          <h3 className="math-phase-subtitle">$1.5K/mo mid. $15K/mo top-decile.</h3>
          <p className="math-phase-lede">75% take-rate, weekly payouts.</p>
          <div className="math-stat-row">
            <div className="math-stat"><span className="math-stat-value">100K</span><span className="math-stat-label">imp / mo · mid</span></div>
            <div className="math-stat"><span className="math-stat-value math-stat-green">$1.5K</span><span className="math-stat-label">take-home</span></div>
          </div>
        </div>
        <div className="math-subband">
          <span className="math-phase-kicker">User</span>
          <h3 className="math-phase-subtitle">$3.75 net / user / month.</h3>
          <p className="math-phase-lede">15 sessions × 50 imp = 750 imp / user / month.</p>
          <div className="math-stat-row">
            <div className="math-stat"><span className="math-stat-value">$15</span><span className="math-stat-label">gross / user</span></div>
            <div className="math-stat"><span className="math-stat-value math-stat-green">$3.75</span><span className="math-stat-label">net / user</span></div>
          </div>
        </div>
        <div className="math-subband">
          <span className="math-phase-kicker">Tokens</span>
          <h3 className="math-phase-subtitle">$0.05 CPM. ~99% margin.</h3>
          <p className="math-phase-lede">$0.50 per 5s clip ÷ 10K impressions.</p>
          <div className="math-stat-row">
            <div className="math-stat"><span className="math-stat-value">$0.50</span><span className="math-stat-label">per clip</span></div>
            <div className="math-stat"><span className="math-stat-value math-stat-green">~99%</span><span className="math-stat-label">gross margin</span></div>
          </div>
        </div>
      </div>

      <div className="math-band math-band-chart">
        <div className="math-chart-left">
          <span className="math-phase-kicker">ARR · Growth</span>
          <h3 className="math-phase-title">$2.3M → $2.25B.</h3>
          <p className="math-phase-lede">Holds the $3.75 / user / month net assumption across the curve. Ads, placements, and brand-side tooling add another ~4× on top - deliberately off-chart so this is just the commission spine.</p>
          <div className="math-growth">
            <div className="math-growth-step"><span className="math-growth-label">Y1</span><span className="math-growth-value">50K</span><span className="math-growth-sub">invite-only</span></div>
            <div className="math-growth-step"><span className="math-growth-label">Y2</span><span className="math-growth-value">500K</span><span className="math-growth-sub">public beta</span></div>
            <div className="math-growth-step"><span className="math-growth-label">Y3</span><span className="math-growth-value">5M</span><span className="math-growth-sub">scaled GTM</span></div>
            <div className="math-growth-step"><span className="math-growth-label">Y5</span><span className="math-growth-value">50M</span><span className="math-growth-sub">category standard</span></div>
          </div>
        </div>
        <div className="math-chart-right">
          <RevenueChart />
        </div>
      </div>

      <div className="math-band math-band-close">
        <div>
          <span className="math-phase-kicker">TAM</span>
          <h3 className="math-phase-subtitle">Global retail is $6T. 1% indexed is a category.</h3>
          <p className="math-phase-lede">If every retail item were in one place - affiliate linked, creator distributed, first-party attributed - even 0.1% penetration is $6B GMV. 1% is $10B+ platform net. The surface is that big.</p>
        </div>
        <div>
          <span className="math-phase-kicker">Flywheel</span>
          <h3 className="math-phase-subtitle">Move the loop once. Everything compounds.</h3>
          <p className="math-phase-lede">Higher commissions pull creators. Creators pull shoppers. Shoppers teach the feed. Sharper feed lifts conversion. Higher conversion funds better rates. Each rotation makes the next one cheaper.</p>
        </div>
      </div>
    </div>
  );
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
   These are the initial values - the user can drag to reposition/resize at runtime. */
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

const DeckViewV1_2: React.FC<DeckViewV1_2Props> = ({
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
  const [techActiveSeed] = useState<number | null>(0);
  // Exit transition for the Demo slide CTA. Set to true on click; the
  // overlay fades in + the slide scales down for ~700ms, then we
  // navigate to catalog.shop.
  const [demoExiting, setDemoExiting] = useState(false);
  const techVideos = ['girl2.mp4', 'guy.mp4', 'Untitled.mp4', 'girl.mp4', 'qm1navb8bjo8fjlgjs5x.mp4'];
  // Deck v1.2 differentiator: the background grid mirrors the consumer
  // home feed - every product with the Home toggle on in /admin/content.
  // Empty until the fetch lands; the dark overlay keeps the cover slide
  // legible regardless.
  const [homeFeed, setHomeFeed] = useState<ProductAd[]>([]);
  // Projections - read once on mount from the same localStorage key the
  // admin page writes to, so the deck's curve mirrors whatever they last
  // dialed in. Falls back to defaults if the key is absent.
  const [projAssumptions, setProjAssumptions] = useState<Assumptions | null>(null);
  useEffect(() => {
    setProjAssumptions(readProjections());
  }, []);
  const projSeries = useMemo(
    () => (projAssumptions ? buildSeries(projAssumptions) : null),
    [projAssumptions],
  );
  const projSummary = useMemo(
    () => (projSeries ? summarize(projSeries) : null),
    [projSeries],
  );
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
    'The Dream',
    'Problem & Solution',
    'Market Opportunity',
    'Payouts',
    'Technology',
    'The Ask',
    'Demo',
    // Appendix (everything below Demo is supplementary)
    'Roadmap',
    'Projections',
    'Closing',
  ];

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const slides = container.querySelectorAll('.deck-slide');

    const hash = window.location.hash.replace('#', '');
    const slideMatch = hash.match(/^deck\/v1-2\/(\d+)$/);
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
              window.history.replaceState(null, '', `#deck/v1-2/${idx + 1}`);
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

  // Pull the home feed once on mount. Same contract as the consumer
  // app: status='live' creative + Home toggle on the product. The deck
  // bypasses the shopper-gender filter so the background reflects the
  // full catalog regardless of who's viewing - investors should see the
  // breadth, not just the slice tagged for the current super-admin
  // toggle. Filtered to rows with a video_url so the grid stays
  // motion-only.
  useEffect(() => {
    let cancelled = false;
    getHomeFeed({ ignoreGender: true }).then(list => {
      if (!cancelled) setHomeFeed(list.filter(r => !!r.video_url));
    }).catch(err => {
      console.error('[DeckViewV1_2] getHomeFeed failed:', err);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className={`deck-view deck-view-v8 deck-view-v9 deck-view-v1 active${bgRevealed ? ' deck-v8-bg-revealed' : ''}`} ref={containerRef}>
      <div className="deck-v8-bg" aria-hidden="true">
        <div className="deck-insight-grid deck-v1-feed-grid">
          {/* v1.2: mirror of the consumer home feed - whatever is toggled
              on as Home in /admin/content. The grid uses the same
              seed-based mosaic FeedSection.tsx applies on the consumer
              feed (8% featured 2x2, 14% wide 2x1, 14% tall 1x2, 64%
              normal 1x1) so the background reads as the actual product
              feed - not a perfect-square wallpaper. We render up to 120
              tiles by cycling through homeFeed (homeFeed[i % len]) so
              even a small live-creative pool fills the parent's 200vh
              inset edge-to-edge. The repeat is intentional - the
              eye reads "endless feed", and any single creative shows
              up in multiple cells of the mosaic so the grid never
              shows blank space at the bottom. */}
          {Array.from({ length: homeFeed.length === 0 ? 0 : 120 }).map((_, i) => {
            const clip = homeFeed[i % homeFeed.length];
            // Same hash FeedSection.tsx uses, with a fixed layoutMode of
            // 0 since the deck doesn't expose a Remix button.
            const seed = (1 * 31 + i * 127) % 100;
            const variant =
              seed < 8  ? 'deck-v1-tile-featured' :
              seed < 22 ? 'deck-v1-tile-wide' :
              seed < 36 ? 'deck-v1-tile-tall' :
                          'deck-v1-tile-normal';
            return (
              <div key={`home:${clip.id}:${i}`} className={`deck-v1-tile ${variant}`}>
                <video
                  src={clip.video_url ?? undefined}
                  muted
                  loop
                  playsInline
                  autoPlay
                  className="deck-insight-video"
                />
              </div>
            );
          })}
        </div>
        <div className="deck-insight-overlay" />
      </div>
      <button className="deck-back-btn" onClick={onBack} aria-label="Back to decks">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
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

      {/* Slide 1: Cover + The Dream merged into one opening slide.
          Catalog wordmark sits at the top; "THE DREAM" label, the
          AI-for-Shopping headline, and the human-taste subtitle land
          below. The animated catalog/book icons float behind. */}
      <div className="deck-slide deck-cover deck-slide-intro deck-v8-cover-intro deck-v8-intro deck-v1-cover-combined">
        <div className="deck-intro-svgs" aria-hidden="true">
          {/* Animated floating catalog/book icons */}
          <svg className="deck-intro-icon deck-intro-icon-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
          <svg className="deck-intro-icon deck-intro-icon-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" /></svg>
          <svg className="deck-intro-icon deck-intro-icon-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>
          <svg className="deck-intro-icon deck-intro-icon-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg>
          <svg className="deck-intro-icon deck-intro-icon-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>
          <svg className="deck-intro-icon deck-intro-icon-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
        </div>
        <CatalogLogo className="deck-logo deck-v8-cover-logo deck-v8-reveal deck-v8-reveal-1" />
        <div className="deck-intro-content">
          <span className="deck-label deck-v8-reveal deck-v8-reveal-1">The Dream</span>
          <h2 className="deck-v8-reveal deck-v8-reveal-2 deck-v1-dream-h2">The AI for Shopping</h2>
          <p className="deck-v8-reveal deck-v8-reveal-2 deck-v1-dream-sub">Human Taste, Powered by AI.</p>
        </div>
      </div>

      {/* Slide 3: Problem & Solution.
          Per-stakeholder row layout - the headline word (Discovery /
          Revenue / Acquisition) is shared between problem and solution
          (one source of truth for "what this stakeholder needs").
          Below the shared header, two side-by-side cells contrast
          today (broken) vs Catalog (fixed) via descriptive text only.

          Animations: each row + cell hooks into the existing v8 fade-
          in-up + blur reveal vocabulary (same easing/timing as the
          rest of the deck) via the deck-v1-compare-row class. Stagger
          delays cascade across the 3 rows so the slide unfolds left-
          to-right then top-to-bottom. The X / check icon strokes
          re-use the existing deck-v8-problem-item draw-on animation. */}
      <div className="deck-slide deck-v8-problem deck-v1-compare-slide">
        <div className="deck-v1-compare-head">
          <span className="deck-label">The Problem &amp; The Solution</span>
          <h2>Creators curate.<br />AI indexes.<br />Everyone wins.</h2>
        </div>
        <div className="deck-v1-compare-rows deck-v1-compare-rows-paired">
          {[
            {
              num: '01',
              role: 'Creators',
              word: 'Revenue',
              problem: 'Disorganized payouts, scatter links, no home base.',
              solution: 'Earn on daily engagement, instant payouts, compound income based on their catalog.',
            },
            {
              num: '02',
              role: 'Shoppers',
              word: 'Discovery',
              problem: 'Fragmented, ad-heavy, impersonal. The keyword search bar lost the plot in 1995.',
              solution: 'Curated by tastemakers they actually follow. No ads, no noise, just the looks they want.',
            },
          ].map(({ num, role, word, problem, solution }, rowIdx, arr) => (
            <React.Fragment key={num}>
              <div
                className="deck-v1-compare-row"
                style={{ ['--row-idx' as string]: rowIdx }}
              >
                <div className="deck-v1-compare-row-head">
                  <span className="deck-v1-compare-row-num">{num}</span>
                  <h3 className="deck-v1-compare-row-role">{role}</h3>
                  <span className="deck-v1-compare-row-word">{word}.</span>
                </div>
                <div className="deck-v1-compare-row-cells">
                  <div className="deck-v1-compare-cell deck-v1-compare-cell-problem deck-v8-problem-item">
                    <div className="deck-v1-compare-cell-label-row">
                      <svg className="deck-v8-broken-icon deck-v1-compare-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle className="broken-circle" cx="12" cy="12" r="10" />
                        <line className="broken-x broken-x-1" x1="8.5" y1="8.5" x2="15.5" y2="15.5" />
                        <line className="broken-x broken-x-2" x1="15.5" y1="8.5" x2="8.5" y2="15.5" />
                      </svg>
                      <span className="deck-v1-compare-cell-label deck-v1-compare-cell-label-problem">Today</span>
                    </div>
                    <p className="deck-v1-compare-cell-text">{problem}</p>
                  </div>
                  <div className="deck-v1-compare-cell deck-v1-compare-cell-solution deck-v8-problem-item">
                    <div className="deck-v1-compare-cell-label-row">
                      <svg className="deck-v8-win-icon deck-v1-compare-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle className="win-circle" cx="12" cy="12" r="10" />
                        <polyline className="win-check" points="7.5 12.5 10.5 15.5 16.5 9" />
                      </svg>
                      <span className="deck-v1-compare-cell-label deck-v1-compare-cell-label-solution">With Catalog</span>
                    </div>
                    <p className="deck-v1-compare-cell-text">{solution}</p>
                  </div>
                </div>
              </div>
              {rowIdx < arr.length - 1 && (
                <div className="deck-v1-compare-link deck-v1-compare-link-bare" aria-hidden="true">
                  <span className="deck-v1-compare-link-line" />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Slide 6: Market Opportunity */}
      <div className="deck-slide deck-v8-market">
        <span className="deck-label">Market Opportunity</span>
        <h2>Trust is the market: three curves, one window.</h2>
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
              // Trust-anchored market figure: the recommendation-driven
              // slice of retail. Three curves on this slide all live
              // downstream of trust - this one names the dollar value
              // explicitly.
              key: 'recommendation',
              value: '$1.0T',
              label: 'Recommendation-driven retail by 2035',
              growth: '+19% CAGR',
              points: '20,118 42,110 64,102 85,92 107,82 129,70 150,60 172,50 194,40 216,32 238,26 260,22',
              source: 'McKinsey, 2024',
              sourceUrl: 'https://www.mckinsey.com/industries/retail/our-insights',
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

      {/* (Projections slide moved further down - now sits as the
          third-to-last slide so the curve is the last thing investors
          see before The Ask.) */}

      {/* Payouts - how creators earn. Engagement + three layered
          affiliate sources + referrals. Sits right after Market
          Opportunity so the conversation goes "here's the market" ->
          "here's how creators get paid for it". */}
      <div className="deck-slide deck-v1-payouts deck-v1-payouts-split">
        <div className="deck-v1-payouts-split-left">
          <span className="deck-label">Payouts</span>
          <h2>Post once.<br />Earn three ways.</h2>
          <p className="deck-v1-payouts-subtitle">Post authentically, earn daily.</p>
          <ul className="deck-v1-payouts-list">
            {([
              {
                num: '01',
                title: 'Engagement',
                chip: 'Daily payouts',
                desc: 'Every click is valuable. Share of total platform clicks equals share of the daily payout pool. Like YouTube’s ad-revenue model, paid out daily.',
              },
              {
                num: '02',
                title: 'Affiliate links',
                chip: '3 sources',
                desc: 'Three layered affiliate streams, all flowing through the same creator.',
                subs: [
                  { num: '2a', title: 'Pass-through', desc: 'A creator’s own affiliate links pay full commission, transparent and fast.' },
                  { num: '2b', title: 'Catalog network', desc: 'We negotiate higher rates with affiliate networks so creators earn more on the same click.' },
                  { num: '2c', title: 'Brand direct', desc: 'As an official Shopify app, we sign revshare deals straight with the brand, the highest take-rate tier.' },
                ],
              },
              {
                num: '03',
                title: 'Referrals',
                chip: 'Lifetime',
                desc: 'Bringing new shoppers onto Catalog earns ongoing rev-share on the sales those users make.',
              },
            ] as Array<{
              num: string;
              title: string;
              chip: string;
              desc: string;
              subs?: Array<{ num: string; title: string; desc: string }>;
            }>).map((item) => (
              <li key={item.num} className="deck-v1-payouts-list-item">
                <span className="deck-v1-payouts-num">{item.num}</span>
                <div className="deck-v1-payouts-list-body">
                  <div className="deck-v1-payouts-list-head">
                    <h3>{item.title}</h3>
                    <span className="deck-v1-payouts-chip">{item.chip}</span>
                  </div>
                  <p>{item.desc}</p>
                  {item.subs && (
                    <ul className="deck-v1-payouts-sublist">
                      {item.subs.map((sub) => (
                        <li key={sub.num} className="deck-v1-payouts-sublist-item">
                          <span className="deck-v1-payouts-subnum">{sub.num}</span>
                          <div className="deck-v1-payouts-sublist-body">
                            <h4>{sub.title}</h4>
                            <p>{sub.desc}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="deck-v1-payouts-split-right" aria-hidden="true">
          {/* Decorative graphic removed. */}
        </div>
      </div>

      {/* Slide 9: Technology - vector DB visual discovery demo.
          Conversation arrives here from Market Opportunity: "here's the
          space, here's the engine that owns it." The Projections curve
          comes much later, just before The Ask. */}
      <div className="deck-slide deck-v9-tech">
        <div className="deck-v9-tech-left">
          <span className="deck-label">Technology</span>
          <h2>Visual taste,<br />indexed by AI.</h2>
          <p className="deck-v9-tech-lede">
            Every look is encoded into a vector database. Composition, color, garment, mood , all become coordinates a model can reason about.
          </p>
          {/* AI partners we wire into Catalog. Each line names the
              company first, then the model + use case in one breath.
              Search & Data (SerpAPI / Rainforest) was removed - those
              are data-lookup services, not AI. */}
          <div className="deck-v1-tech-stack">
            <div className="deck-v1-tech-stack-group">
              <span className="deck-v1-tech-stack-label">Reasoning</span>
              <ul>
                <li><strong>Anthropic</strong>, Claude Sonnet 4.5/4.6, Haiku 4.5/3.5</li>
                <li><strong>Google</strong>, Gemini Flash</li>
              </ul>
            </div>
            <div className="deck-v1-tech-stack-group">
              <span className="deck-v1-tech-stack-label">Video</span>
              <ul>
                <li><strong>Bytedance</strong>, Seedance 2.0 Pro &amp; Fast</li>
                <li><strong>Google</strong>, Veo 3.1</li>
                <li><strong>Tencent</strong>, Vidu</li>
              </ul>
            </div>
            <div className="deck-v1-tech-stack-group">
              <span className="deck-v1-tech-stack-label">Embeddings &amp; Vector</span>
              <ul>
                <li><strong>TwelveLabs</strong>, Marengo 3.0 video embeddings</li>
                <li><strong>Postgres</strong>, pgvector storage</li>
              </ul>
            </div>
            <div className="deck-v1-tech-stack-group">
              <span className="deck-v1-tech-stack-label">Compute</span>
              <ul>
                <li><strong>Modal</strong>, serverless agents</li>
                <li><strong>Fal.ai</strong>, video generation queue</li>
              </ul>
            </div>
          </div>
        </div>
        <div className="deck-v9-tech-right">
          <div className="deck-v1-tech-stage" key={`tech-${techActiveSeed}`}>
            <div className="deck-v1-tech-seed">
              <video src={`${basePath}/${techVideos[techActiveSeed ?? 0]}`} autoPlay loop muted playsInline />
            </div>
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
            <div className="deck-v1-tech-neighbors">
              {[0, 1, 2, 3, 4].map((n) => {
                const src = techVideos[techActiveSeed ?? 0];
                const tints = [
                  'hue-rotate(15deg) saturate(1.1)',
                  'hue-rotate(-20deg) saturate(0.95)',
                  'hue-rotate(35deg) saturate(1.05)',
                  'hue-rotate(-45deg) saturate(0.9)',
                  'hue-rotate(60deg) saturate(1.15)',
                ];
                return (
                  <div
                    key={`neighbor-${techActiveSeed}-${n}`}
                    className="deck-v1-tech-neighbor"
                    style={{ '--n-i': n } as React.CSSProperties}
                  >
                    <video
                      src={`${basePath}/${src}`}
                      autoPlay
                      loop
                      muted
                      playsInline
                      style={{ filter: tints[n] }}
                    />
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

      {/* The Ask - moved up to slide 6 (right after Technology) so the
          round-size + funnel ask sits before the product / flywheel
          mechanics, not at the very end. */}
      <div className="deck-slide deck-v8-ask">
        <span className="deck-label">The Ask</span>
        <h2>Capital to build the flywheel.</h2>

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

          {/* Flywheel components - the SVG flow lines from the round-size
              card terminate at three dots; these cards sit directly under
              those dots so the eye reads "$2.5M flows into these three
              flywheel components". Same data the standalone "Start the
              flywheel" framing carries elsewhere in the deck - here the
              point is "where the money goes", not the narrative arc. */}
          <div className="deck-v8-ask-priorities deck-v8-ask-components">
            <div className="deck-v8-ask-priority">
              <span className="deck-v8-ask-priority-num">01</span>
              <h3>Product Seeding</h3>
              <p>Autonomous product sync, AI creative generation, vector indexing , Catalog launches with inventory built in, no cold start.</p>
            </div>
            <div className="deck-v8-ask-priority">
              <span className="deck-v8-ask-priority-num">02</span>
              <h3>Go to Market</h3>
              <p>Onboard the first wave of creators with free tools, fast payouts, and instant storefronts. Public launch with proven unit economics.</p>
            </div>
            <div className="deck-v8-ask-priority">
              <span className="deck-v8-ask-priority-num">03</span>
              <h3>Brand Pull</h3>
              <p>Launch the fixed-ROAS model with early brand partners. Prove the economics that make the marketplace self-sustaining.</p>
            </div>
          </div>

          {/* Outcome callout: the three priorities feed a single
              result. Lands after the priority cards and connects up to
              them with a thin vertical tick so the eye reads
              "priorities -> sustained growth". */}
          <div className="deck-v8-ask-outcome">
            <span className="deck-v8-ask-outcome-tick" aria-hidden="true" />
            <span className="deck-v8-ask-outcome-pill">
              <svg className="deck-v8-ask-outcome-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 17l6-6 4 4 8-8" />
                <polyline points="14 7 21 7 21 14" />
              </svg>
              <span className="deck-v8-ask-outcome-label">Sustained growth</span>
              <span className="deck-v8-ask-outcome-sub">Flywheel spins on its own.</span>
            </span>
          </div>
        </div>
      </div>

      {/* Demo - the dramatic close of the main pitch. CTA shoots the
          investor over to catalog.shop with a fade-to-black exit. The
          appendix arrow at the bottom signals that everything below
          this slide is supporting material. */}
      <div className="deck-slide deck-v1-demo-slide">
        <span className="deck-label">Demo</span>
        <h2 className="deck-v1-demo-h2">See the demo.</h2>
        <p className="deck-v1-demo-sub">Open the app. See it work.</p>
        <button
          type="button"
          className={`deck-v1-demo-cta${demoExiting ? ' is-exiting' : ''}`}
          disabled={demoExiting}
          onClick={() => {
            if (demoExiting) return;
            setDemoExiting(true);
            // Cool exit: 700ms fade-to-black + scale, then jump.
            window.setTimeout(() => {
              window.location.href = 'https://catalog.shop';
            }, 700);
          }}
        >
          <CatalogLogo className="deck-v1-demo-cta-logo" />
          <svg className="deck-v1-demo-cta-arrow" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="13 6 19 12 13 18" />
          </svg>
        </button>

        {/* Appendix indicator - everything below this slide is supporting
            material. Down-arrow + label cue the audience that the deck
            isn't over but the main pitch is. */}
        <div className="deck-v1-demo-appendix" aria-hidden="true">
          <span className="deck-v1-demo-appendix-label">Appendix</span>
          <svg className="deck-v1-demo-appendix-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <polyline points="6 13 12 19 18 13" />
          </svg>
        </div>

        {/* Full-screen exit overlay - fades in over the slide while we
            wait for window.location.href to load catalog.shop. Sits
            above every other element on the slide. */}
        {demoExiting && <div className="deck-v1-demo-exit-overlay" aria-hidden="true" />}
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

      {/* Projections - 16-month revenue model wired live to the
          assumptions stored on /admin/projections. Sits as the
          third-to-last slide (right before The Ask) so the curve is
          the closing economic argument before the round size. */}
      <div className="deck-slide deck-v1-projections-slide">
        <div className="deck-v1-projections-head">
          <span className="deck-label">Projections</span>
          <h2>16 months from one sale to a run-rate.</h2>
          <p className="deck-v1-projections-sub">
            Live from the model on /admin/projections. Hover any month for the funnel breakdown.
          </p>
        </div>
        {projAssumptions && projSeries && (
          <>
            <div className="deck-v1-projections-summary">
              <div className="deck-v1-projections-stat">
                <span className="deck-v1-projections-stat-label">{PROJ_MONTHS}-mo total</span>
                <span className="deck-v1-projections-stat-value">{fmtCurrency(projSummary!.total)}</span>
              </div>
              <div className="deck-v1-projections-stat">
                <span className="deck-v1-projections-stat-label">Final month</span>
                <span className="deck-v1-projections-stat-value">{fmtCurrency(projSummary!.finalMonth)}</span>
              </div>
              <div className="deck-v1-projections-stat">
                <span className="deck-v1-projections-stat-label">Exit run-rate (ARR)</span>
                <span className="deck-v1-projections-stat-value">{fmtCurrency(projSummary!.finalRunRate)}</span>
              </div>
              <div className="deck-v1-projections-stat">
                <span className="deck-v1-projections-stat-label">Implied CAGR</span>
                <span className="deck-v1-projections-stat-value">{fmtPercent(projSummary!.cagrEquivalent, 0)}</span>
              </div>
            </div>
            <ProjectionsChart series={projSeries} />
            <p className="deck-v1-projections-formula">
              Revenue = MAU × sessions/user × impressions/session × conversion × avg sale × commission &nbsp;·&nbsp;
              MAU growth tapers <strong>{fmtPercent(projAssumptions.mauGrowthStart)}</strong> → <strong>{fmtPercent(projAssumptions.mauGrowthEnd)}</strong> MoM
            </p>
          </>
        )}
      </div>

      {/* Slide 13: Final */}
      <div className="deck-slide deck-cover">
        <CatalogLogo className="deck-logo" />
        <p className="deck-subtitle">Human Taste, Powered by AI</p>
        <div className="deck-end-actions">
          <button className="deck-mvp-btn" id="deck-mvp-btn" onClick={onSeeApp}>See the product</button>
          <a className="deck-mvp-btn" href={`${basePath}/trademark.pdf`} target="_blank" rel="noopener noreferrer">Trademark</a>
        </div>
      </div>
    </div>
  );
};

export default DeckViewV1_2;
