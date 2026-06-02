// ShoppingForHero — the new home entry. A full-viewport matte-black ask
// screen ("What are you shopping for?"). The single search input is the
// app's bottom bar (with filters) — the hero has no pill of its own. The
// catalog feed lives directly below; scrolling reveals the best sellers.

import { useEffect, useRef, useMemo } from 'react';

// Headline rotation. First HEADLINE_BASELINE_VISITS the user sees the
// canonical "What are you shopping for?". After that, we pick from
// FUN_HEADLINES (deterministic per visit so the headline doesn't change
// mid-session — seeded by visit-count so each new visit rotates).
// Visit count is stored in localStorage so we don't try to hit the DB
// for every landing.
const HEADLINE_VISIT_KEY = 'catalog:hero-visits:v1';
const HEADLINE_BASELINE_VISITS = 3;

interface Headline {
  line1: string;
  line2: string;
  /** Optional small credit line rendered under the title. Used for lyric
   *  attributions ("— Spice Girls") so the source is acknowledged
   *  without crowding the headline itself. */
  credit?: string;
  /** When true, the title renders in italic / quoted form to read as a
   *  lyric rather than a question. */
  lyric?: boolean;
}

const BASELINE_HEADLINE: Headline = { line1: 'What are you', line2: 'shopping for?' };

// Each entry is two lines (.sfh-title renders the same vertical shape as
// the baseline). Keep ≤ ~22 chars per line so it doesn't wrap.
const FUN_HEADLINES: ReadonlyArray<Headline> = [
  // Spice Girls lyric — rendered with quotes + italic + credit.
  { line1: 'Tell me what you want,', line2: 'what you really, really want.', lyric: true, credit: '— Spice Girls' },
  // Genuine but playful.
  { line1: 'What sparks joy', line2: 'today?' },
  { line1: 'What you got',   line2: 'on your mind?' },
  { line1: 'Today, you are', line2: 'shopping for…' },
  // Pop-culture nudges.
  { line1: "What's in your", line2: 'cart energy?' },
  { line1: 'Treat yourself.', line2: 'What is it?' },
  { line1: 'Looking for that', line2: 'one thing?' },
  { line1: 'Speak it into', line2: 'existence.' },
  { line1: 'Manifest your',  line2: 'next outfit.' },
  // Mood-board style.
  { line1: 'What is the',    line2: 'vibe today?' },
  { line1: 'Catalog mode:',  line2: 'engaged.' },
  { line1: 'Type a wish,',   line2: 'get a catalog.' },
  // Cheeky.
  { line1: 'Confess.',       line2: 'What do you want?' },
  { line1: 'Be honest with us.', line2: 'What is it?' },
  { line1: 'Talk to me,',    line2: 'I am all ears.' },
];

function readVisitCount(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.localStorage.getItem(HEADLINE_VISIT_KEY);
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch { return 0; }
}
function bumpVisitCount(): void {
  if (typeof window === 'undefined') return;
  try {
    const n = readVisitCount() + 1;
    window.localStorage.setItem(HEADLINE_VISIT_KEY, String(n));
  } catch { /* quota */ }
}
// ParticleBackground is mounted once at the app root (SiteParticleHost) so
// the hero shares the same field as splash + ceremony + empty-catalog.

interface ShoppingForHeroProps {
  /** Scroll the page to the home feed below (the "best sellers" hint). */
  onRevealFeed?: () => void;
}

export default function ShoppingForHero({ onRevealFeed }: ShoppingForHeroProps) {
  // Pick a headline for this visit. The first HEADLINE_BASELINE_VISITS the
  // user lands here they see the canonical "What are you shopping for?";
  // beyond that, we rotate through FUN_HEADLINES picked via the visit
  // index (so the same visit always shows the same line — no flicker if
  // the component remounts mid-session — but a new visit rotates).
  const headline = useMemo<Headline>(() => {
    const visits = readVisitCount();
    if (visits < HEADLINE_BASELINE_VISITS) return BASELINE_HEADLINE;
    return FUN_HEADLINES[(visits - HEADLINE_BASELINE_VISITS) % FUN_HEADLINES.length];
  }, []);
  // Bump the visit count once on mount so the NEXT landing rotates.
  useEffect(() => { bumpVisitCount(); }, []);

  // Scroll-reactive spin: the further down the shopper has scrolled within
  // the first viewport, the more we boost the spark's idle spin. We write
  // the value to a CSS custom property so the CSS animation reads it and
  // shortens its duration without React re-rendering on every scroll tick.
  const sparkRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      const el = sparkRef.current;
      if (!el) return;
      const ratio = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.8)));
      // Boost factor 0 → 4: at rest the spark spins slowly; on full scroll
      // it spins ~5× faster.
      el.style.setProperty('--sfh-spark-boost', String(ratio * 4));
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section className="sfh" aria-label="What are you shopping for?">
      <div className="sfh-stage">
        {/*
          Brand mark — a 4-point "AI" diamond at center surrounded by four
          tiny catalog tiles orbiting at cardinal points (the catalog
          identity, what distinguishes us from Gemini's pure spark).
          • Mount animation spins it into place from -360deg + 0.4 scale.
          • Idle: the inner diamond rotates slowly; the orbit ring spins the
            opposite way and the tiles breathe in/out.
          • Scroll: --sfh-spark-boost makes the rotation speed up.
        */}
        <div className="sfh-spark" aria-hidden="true" ref={sparkRef}>
          <svg viewBox="0 0 140 140" width="72" height="72">
            <defs>
              <linearGradient id="sfh-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#fff" />
                <stop offset="50%" stopColor="#cbd5e1" />
                <stop offset="100%" stopColor="#94a3b8" />
              </linearGradient>
              <radialGradient id="sfh-tile-grad" cx="50%" cy="40%" r="60%">
                <stop offset="0%" stopColor="#fff" />
                <stop offset="100%" stopColor="#64748b" />
              </radialGradient>
            </defs>

            {/* Orbit ring — catalog tiles at N/E/S/W. Rotates opposite to
                the inner diamond so they appear to glide past each other. */}
            <g className="sfh-spark-orbit">
              <rect className="sfh-spark-tile" x="65"  y="6"   width="10" height="10" rx="2" fill="url(#sfh-tile-grad)" />
              <rect className="sfh-spark-tile" x="124" y="65"  width="10" height="10" rx="2" fill="url(#sfh-tile-grad)" />
              <rect className="sfh-spark-tile" x="65"  y="124" width="10" height="10" rx="2" fill="url(#sfh-tile-grad)" />
              <rect className="sfh-spark-tile" x="6"   y="65"  width="10" height="10" rx="2" fill="url(#sfh-tile-grad)" />
            </g>

            {/* Inner 4-point diamond — the AI mark. */}
            <g className="sfh-spark-core" style={{ transformOrigin: '70px 70px' }}>
              <path
                transform="translate(20 20)"
                d="M50 4 C54 30 70 46 96 50 C70 54 54 70 50 96 C46 70 30 54 4 50 C30 46 46 30 50 4 Z"
                fill="url(#sfh-grad)"
              />
            </g>
          </svg>
        </div>

        {/* Lyric headlines render in italic + smart quotes; normal
            headlines render as-is. Optional `credit` line sits below in
            a small caption when present. */}
        <h1 className={`sfh-title${headline.lyric ? ' sfh-title--lyric' : ''}`}>
          {headline.lyric ? '“' : ''}
          {headline.line1}
          <br/>
          {headline.line2}
          {headline.lyric ? '”' : ''}
        </h1>
        {headline.credit && (
          <div className="sfh-title-credit" aria-label="Lyric credit">
            {headline.credit}
          </div>
        )}
      </div>

      {/* Scroll-to-best-sellers affordance: an animated mouse with a
          dot that travels down, plus a bobbing chevron + label. */}
      <button type="button" className="sfh-scroll-hint" onClick={onRevealFeed} aria-label="Scroll to see most popular">
        {/* Desktop: a scroll-mouse. Mobile: a swiping finger (CSS swaps). */}
        <span className="sfh-mouse" aria-hidden="true"><span className="sfh-mouse-dot" /></span>
        <span className="sfh-finger" aria-hidden="true">
          <svg width="26" height="30" viewBox="0 0 24 24" fill="currentColor">
            <path d="M13 9V4.5a1.5 1.5 0 0 0-3 0V12L8.2 10.4a1.6 1.6 0 0 0-2.2 2.3l3.4 3.6A5 5 0 0 0 13.1 18H16a4 4 0 0 0 4-4v-3a1.5 1.5 0 0 0-3 0 1.5 1.5 0 0 0-3 0 1.5 1.5 0 0 0-1 .1V9z"/>
          </svg>
        </span>
        <span className="sfh-scroll-label">Scroll to see most popular</span>
        <svg className="sfh-scroll-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    </section>
  );
}
