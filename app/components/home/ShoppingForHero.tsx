// ShoppingForHero — the new home entry. A full-viewport matte-black ask
// screen ("What are you shopping for?"). The single search input is the
// app's bottom bar (with filters) — the hero has no pill of its own. The
// catalog feed lives directly below; scrolling reveals the best sellers.

import { useEffect, useRef, useMemo, useState } from 'react';

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
  /** When true, the title renders in italic so song lyrics and quotes
   *  read distinct from questions/prompts. The 🎵 / 🎬 prefix lives in
   *  the line text itself (kept inline rather than as a separate
   *  caption — that matches the visual rhythm of the non-lyric
   *  headlines which are also two-line plain text). */
  lyric?: boolean;
}

const BASELINE_HEADLINE: Headline = { line1: 'What are you', line2: 'shopping for?' };

// 50+ variations. Each entry is two lines (.sfh-title renders the same
// vertical shape as the baseline). Keep each line ≤ ~26 chars so it
// doesn't wrap on a phone. Mix:
//   • Plain prompts / cheeky / playful
//   • Mood-board + aspirational
//   • Occasion-driven
//   • Song lyrics (🎵 + italic) — culturally recognizable enough that
//     the source is implicit; we don't credit explicitly anymore
//     because the caption competed with the headline.
const FUN_HEADLINES: ReadonlyArray<Headline> = [
  // The ONE musical headline — Spice Girls. All other lyric variants
  // were dropped per the latest direction; one lyric is enough flavor.
  { lyric: true, line1: '🎵 Tell me what you want,',     line2: 'what you really really want.' },

  // Plain prompts — playful, no italic.
  { line1: 'What sparks joy',         line2: 'today?' },
  { line1: 'What you got',            line2: 'on your mind?' },
  { line1: 'Today, you are',          line2: 'shopping for…' },
  { line1: "What's in your",          line2: 'cart energy?' },
  { line1: 'Treat yourself.',         line2: 'What is it?' },
  { line1: 'Looking for that',        line2: 'one thing?' },
  { line1: 'Speak it into',           line2: 'existence.' },
  { line1: 'Manifest your',           line2: 'next outfit.' },
  { line1: 'What is the',             line2: 'vibe today?' },
  { line1: 'Catalog mode:',           line2: 'engaged.' },
  { line1: 'Type a wish,',            line2: 'get a catalog.' },
  { line1: 'Confess.',                line2: 'What do you want?' },
  { line1: 'Be honest with us.',      line2: 'What is it?' },
  { line1: 'Talk to me,',             line2: "I'm all ears." },
  { line1: 'Out with it.',            line2: "What's the wish?" },
  { line1: "We're listening.",        line2: 'Whatcha need?' },
  { line1: 'Words, please.',          line2: 'Any words.' },
  { line1: 'Spell it out.',           line2: "We've got you." },
  { line1: "What's calling",          line2: 'your name?' },
  { line1: 'Let it rip.',             line2: 'What is it?' },

  // Mood-board / aspirational.
  { line1: 'Match my mood,',          line2: 'match my fit.' },
  { line1: 'Set the tone.',           line2: "We'll set the cart." },
  { line1: 'Soft-launch your',        line2: 'next look.' },
  { line1: 'Quiet luxury,',           line2: 'loud confidence.' },
  { line1: 'Old money,',              line2: 'new fits.' },
  { line1: 'Main-character',          line2: 'energy, loaded.' },
  { line1: 'Off-duty',                line2: 'model mode.' },
  { line1: "It's giving…",            line2: 'what exactly?' },
  { line1: 'Dress for the',           line2: 'day you want.' },
  { line1: 'Look like a',             line2: 'million.' },

  // Occasion / weather / context.
  { line1: 'Date night or',           line2: 'movie night?' },
  { line1: 'Brunch or',               line2: 'boardroom?' },
  { line1: 'Beach or bar?',           line2: 'Yes.' },
  { line1: 'Cozy, chic,',             line2: 'or chaos?' },
  { line1: 'Dark academia?',          line2: 'Y2K? Both?' },
  { line1: 'Pack for the',            line2: 'trip in your head.' },
  { line1: 'Dressing for',            line2: 'which weather?' },
  { line1: 'Weekend plans?',          line2: 'Outfit plans?' },

  // Cheeky / weird.
  { line1: "Let's get weird.",        line2: "What's it gonna be?" },
  { line1: 'Imagine it.',             line2: "We'll catalog it." },
  { line1: 'Be specific.',            line2: 'Be wild.' },
  { line1: 'No bad ideas.',           line2: "What's the idea?" },

  // 30 NEW plain headlines — same shape, same playful tone, no lyrics.
  // Conversational / cheeky.
  { line1: "What's the mood,",        line2: "what's the move?" },
  { line1: 'Surprise us.',            line2: 'What is it?' },
  { line1: 'Dare us.',                line2: 'What do you want?' },
  { line1: 'We can read minds.',      line2: 'Just kidding.' },
  { line1: 'Pretend money',           line2: 'is no object.' },
  { line1: 'What would Future You',   line2: 'want today?' },
  { line1: 'Best version of you',     line2: 'wears what?' },
  { line1: 'No wrong answers.',       line2: 'Type away.' },
  { line1: 'Tell us nothing,',        line2: 'get nothing.' },
  { line1: 'Lay it on us.',           line2: "What's the ask?" },

  // Mood / aspirational.
  { line1: 'Effortless, but',         line2: 'on purpose.' },
  { line1: 'Investment piece',        line2: 'energy.' },
  { line1: 'Closet upgrade',          line2: 'incoming.' },
  { line1: 'The perfect basic',       line2: 'awaits.' },
  { line1: 'Less, but better.',       line2: 'What is it?' },
  { line1: 'One great thing,',        line2: 'today.' },
  { line1: 'Statement piece,',        line2: 'inbound.' },
  { line1: 'Confidence in',           line2: 'fabric form.' },
  { line1: 'Wardrobe stage left,',    line2: 'new fit enter.' },
  { line1: 'Wear it like',            line2: 'you mean it.' },

  // Occasion / context.
  { line1: 'Heading out?',            line2: 'Heading in?' },
  { line1: 'First impression',        line2: 'kind of day?' },
  { line1: 'Comfortable,',            line2: 'but cute?' },
  { line1: 'Concert fit,',            line2: 'coffee fit?' },
  { line1: 'Dinner, drinks,',         line2: 'or dance?' },
  { line1: 'New city,',               line2: 'new fit?' },
  { line1: 'Going viral,',            line2: 'dressing for it.' },
  { line1: 'Closet refresh',          line2: "o'clock." },
  { line1: 'The vibe is yours.',      line2: 'Set it.' },
  { line1: 'Bookmark-worthy',         line2: 'shopping.' },
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
  // "How your daily feed works" popup — opened from the ? next to the cue.
  const [showFeedInfo, setShowFeedInfo] = useState(false);
  useEffect(() => {
    if (!showFeedInfo) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowFeedInfo(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showFeedInfo]);
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
      // Boost factor 0 → 1.5: at rest the spark spins slowly; on full scroll
      // it spins ~2.5× faster. Kept gentle — a hard scroll-spin felt frantic.
      el.style.setProperty('--sfh-spark-boost', String(ratio * 1.5));
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

        {/* Lyric headlines render in italic; non-lyric render plain.
            The 🎵 / 🎬 prefix on line 1 (when present) is the only
            "this is a quote" cue — kept inline so the lyric headline
            occupies the same vertical shape as the plain ones, no
            attribution caption below. */}
        <h1 className={`sfh-title${headline.lyric ? ' sfh-title--lyric' : ''}`}>
          {headline.line1}
          <br/>
          {headline.line2}
        </h1>
      </div>

      {/* Scroll-to-your-daily-feed affordance: an animated mouse + label
          (tap to reveal the feed), a one-line tagline with a ? that opens
          the full explanation, and a bobbing chevron. */}
      <div className="sfh-scroll-hint">
        {/* Desktop keeps the subtle scroll-mouse; mobile shows no icon —
            just the label + chevron (the down-finger glyph read as clutter). */}
        <span className="sfh-mouse" aria-hidden="true"><span className="sfh-mouse-dot" /></span>
        <button type="button" className="sfh-scroll-cta" onClick={onRevealFeed} aria-label="Open your daily feed">
          Your daily feed
        </button>
        <span className="sfh-scroll-sub">
          A fresh feed, tuned to you, every day.
          <button
            type="button"
            className="sfh-scroll-info"
            onClick={() => setShowFeedInfo(true)}
            aria-label="How your daily feed works"
          >?</button>
        </span>
        <button type="button" className="sfh-scroll-chev-btn" onClick={onRevealFeed} aria-label="Scroll to your feed">
          <svg className="sfh-scroll-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {/* "How your daily feed works" popup. */}
      {showFeedInfo && (
        <div className="sfh-feed-info" role="dialog" aria-modal="true" aria-label="How your daily feed works" onClick={() => setShowFeedInfo(false)}>
          <div className="sfh-feed-info-card" onClick={e => e.stopPropagation()}>
            <button type="button" className="sfh-feed-info-close" onClick={() => setShowFeedInfo(false)} aria-label="Close">×</button>
            <h3 className="sfh-feed-info-title">Your daily feed</h3>
            <p className="sfh-feed-info-body">
              Every day you get a brand-new feed, hand-tuned to your taste. The more you
              tap, save, and shop, the sharper it gets, like a personal stylist who never
              sleeps (and never judges your 2&nbsp;a.m. browsing).
            </p>
            <p className="sfh-feed-info-body">Come back tomorrow for a whole new lineup.</p>
          </div>
        </div>
      )}
    </section>
  );
}
