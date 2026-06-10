// SearchCeremony — the agentic "answer-engine" loading flow shown between a
// hero search and its results. Modeled on how Claude / Perplexity narrate
// work:
//   1. Query echo      — the committed query pinned at the top.
//   2. Thinking state  — concrete "tool" steps stream in one at a time, each
//                        with a spinner that resolves to a check (progress
//                        narration). The final step holds until the real
//                        search resolves.
//   3. Reveal          — once ready (and the narration has played out) it
//                        calls onDone and the results hydrate in.
// A hard MAX_DURATION guarantees we never hang if `ready` never arrives.

import { useEffect, useRef, useState } from 'react';
import ParticleBackground from '~/components/ParticleBackground';
import { getHomeFeed, getProductImagesForQuery } from '~/services/product-creative';
// Speed is dialed up while the ceremony is on screen so the field reads
// as "searching the world", then restored on cleanup. The ceremony's own
// ParticleBackground sits ABOVE its opaque scrim so the field is visible
// against the scrim (the site singleton sits below the scrim and is
// hidden during the ceremony — that's intentional: the ceremony covers
// the feed, but its own particle layer keeps the brand world alive).
import { particleControls } from '~/services/particles';

interface SearchCeremonyProps {
  query: string;
  /** What triggered the ceremony — drives the narration copy:
   *    'search' → "Understanding 'X'", generic loading steps
   *    'brand'  → "Finding everything from X", brand-specific steps
   *  Defaults to 'search' so existing callers don't have to change. */
  kind?: 'search' | 'brand';
  /** True once the real search results are in hand. */
  ready: boolean;
  /** Fired once the narration has played out AND ready is true. */
  onDone: () => void;
  /** Result product images to float in the particle field behind the stage
   *  (the searched products drifting in space). Populated once results land. */
  floatingImages?: string[];
}

const MIN_DURATION_MS = 2400;
const MAX_DURATION_MS = 7000;
/** How many product tiles can float behind the stage at most. */
const FLOATER_SLOTS = 8;

// Hand-placed scatter for the floating tiles — TOP and BOTTOM bands only,
// kept clear of the centered thinking card (which lives in the y 30-72%
// middle), and spaced so tiles don't overlap each other. Interleaved
// top/bottom so the progressive reveal scatters evenly instead of filling
// one band first. {x, y} are viewport percentages of the tile's center.
const FLOATER_SLOTS_POS: { x: number; y: number }[] = [
  { x: 18, y: 11 }, { x: 16, y: 84 },
  { x: 41, y: 6 },  { x: 45, y: 92 },
  { x: 63, y: 13 }, { x: 60, y: 82 },
  { x: 85, y: 8 },  { x: 86, y: 88 },
];
/** How fast the thinking steps stream in, one after another. */
const STEP_INTERVAL_MS = 600;
/** Beat to hold on the all-checks state before revealing results. */
const SETTLE_MS = 420;

// Agentic progress narration — concrete steps streamed one by one with a
// spinner→check. The first always echoes the query; the middle three are
// picked randomly from a pool that's roughly 50/50 jokes/serious so the
// loading moment feels like a personality, not a checklist. The last
// always says "Composing your edit" so the closer is consistent.
const SERIOUS_MIDDLE_STEPS = [
  'Searching the catalog',
  'Matching products & styles',
  'Ranking the best looks',
  'Cross-referencing your size',
  "Checking what's in stock",
  'Reading the room',
];
const FUNNY_MIDDLE_STEPS = [
  'Asking the algorithm nicely',
  'Bribing the trend forecasters',
  'Consulting a very stylish raccoon',
  'Negotiating with the fashion gods',
  'Pulling looks from the multiverse',
  'Whispering to the catalog spirits',
  'Hyping up the AI',
  'Running this by Anna Wintour',
  'Untangling the fit predictions',
  'Doing math in heels',
  'Asking what your ex would hate',
  'Filtering out the ick',
];

function pick<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length; i++) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}

// Brand-specific narration. Subject is the brand name; copy plays
// up the "we're loading EVERYTHING from this brand" feel the user
// asked for, with a couple of jokes mixed in for personality.
const BRAND_MIDDLE_STEPS = (brand: string) => [
  `Pulling every look from ${brand}`,
  `Lining up the ${brand} catalog`,
  `Asking ${brand} for their best fits`,
  `Sorting the ${brand} drops by buzz`,
  `Reading every ${brand} product page`,
  `Decoding what makes ${brand} so good`,
];

function buildSteps(query: string, kind: 'search' | 'brand'): string[] {
  const q = query.trim();
  const subject = q.length > 32 ? `${q.slice(0, 31)}…` : q;
  if (kind === 'brand' && subject) {
    // Brand mode: first line names the brand explicitly, three middle
    // steps from the brand pool, consistent closer.
    const middle = pick(BRAND_MIDDLE_STEPS(subject), 3);
    return [
      `Finding everything from ${subject}`,
      ...middle,
      `Composing your ${subject} edit`,
    ];
  }
  // Default search mode — roughly 50/50 serious/funny middle steps.
  const middle: string[] = [];
  middle.push(...pick(SERIOUS_MIDDLE_STEPS, 2));
  middle.push(...pick(FUNNY_MIDDLE_STEPS, 2));
  for (let i = middle.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [middle[i], middle[j]] = [middle[j], middle[i]];
  }
  return [
    subject ? `Understanding "${subject}"` : 'Understanding your request',
    ...middle.slice(0, 3),
    'Composing your edit',
  ];
}

export default function SearchCeremony({ query, kind = 'search', ready, onDone, floatingImages = [] }: SearchCeremonyProps) {
  const steps = useRef(buildSteps(query, kind)).current;
  // How many steps are currently visible (they stream in over time).
  const [revealed, setRevealed] = useState(1);
  const [progress, setProgress] = useState(6);
  const startedAt = useRef(Date.now());
  const reduced = typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const allRevealed = revealed >= steps.length;
  // Every step gets a check once the search is in AND the narration has fully
  // streamed in; until then the last-revealed step spins as the "active" one.
  const finalDone = ready && allRevealed;

  // Products "forming" in the background, revealed progressively as each
  // phase completes — more tiles the closer the ceremony gets to done, so it
  // reads as "it's almost there, products are coming together". Prefer the
  // real result images (floatingImages) as they land; meanwhile pull a pool
  // from the home feed so something still forms during the loading beat. The
  // pool only ever GROWS (deduped, capped) and tiles are keyed by src, so
  // already-floating ones never jump when new ones fade in beside them.
  const [pool, setPool] = useState<string[]>(() => floatingImages.slice(0, FLOATER_SLOTS));
  const mergeImages = (incoming: string[]) => setPool(prev => {
    const seen = new Set(prev);
    const next = [...prev];
    for (const s of incoming) {
      if (next.length >= FLOATER_SLOTS) break;
      if (s && !seen.has(s)) { next.push(s); seen.add(s); }
    }
    return next.length === prev.length ? prev : next;
  });
  // The real semantic results claim slots as they land (best match).
  useEffect(() => { if (floatingImages.length) mergeImages(floatingImages); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [floatingImages]);
  // Precursor: products RELATED to the query, fetched fast so the field hints
  // at what's coming ("jeans" → denim, "shoes" → sneakers). If the query
  // matched little, top up with the home feed so the field never looks empty.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let imgs: string[] = [];
      try { imgs = await getProductImagesForQuery(query, FLOATER_SLOTS * 2); } catch { /* */ }
      if (cancelled) return;
      if (imgs.length < 4) {
        try {
          const feed = await getHomeFeed({ ignoreGender: true });
          if (cancelled) return;
          imgs = [...imgs, ...feed.map(a =>
            a.product?.primary_image_url || a.product?.image_url || a.thumbnail_url || '',
          ).filter(Boolean)];
        } catch { /* keep the query matches we have */ }
      }
      mergeImages(imgs);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Visible tile count ramps with each completed phase (a couple per phase),
  // so the field fills in as the narration progresses.
  const phaseRatio = steps.length > 0 ? revealed / steps.length : 1;
  const visibleFloaters = Math.min(pool.length, Math.ceil(phaseRatio * FLOATER_SLOTS));

  // Stream the steps in, one at a time.
  useEffect(() => {
    if (revealed >= steps.length) return;
    const t = window.setTimeout(
      () => setRevealed(r => Math.min(r + 1, steps.length)),
      STEP_INTERVAL_MS,
    );
    return () => window.clearTimeout(t);
  }, [revealed, steps.length]);

  // Progress thread: ease toward the current step's share while waiting; snap
  // to 100% once everything's done.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      // `settled` flips true once progress has eased to within a hair of its
      // current target; we then STOP the loop instead of re-scheduling forever
      // (the old code kept firing setProgress(100) at 60fps after completion,
      // and kept ticking toward the interim cap while waiting). The effect
      // re-arms on the next `revealed`/`finalDone` change, so the bar animates
      // to each new target then parks — no idle 60fps spin.
      let settled = false;
      setProgress(p => {
        const target = finalDone ? 100 : Math.min(88, 12 + revealed * 16);
        const next = p + (target - p) * (finalDone ? 0.25 : 0.06);
        if (Math.abs(target - next) < 0.1) { settled = true; return finalDone ? 100 : target; }
        return next > 99.5 ? 100 : next;
      });
      if (settled) return;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [finalDone, revealed]);

  // Exit once the search is ready, the narration has fully streamed in, and
  // the minimum on-screen time has elapsed — then hold a beat on the all-
  // checks state so it reads as "done" before the results take over.
  useEffect(() => {
    if (!ready || !allRevealed) return;
    const elapsed = Date.now() - startedAt.current;
    // Original length — no extra hold for the product reveal. The products
    // only show if they've already loaded by now (see finalDone gate below);
    // we never wait on them, so the ceremony stays short.
    const wait = Math.max(0, MIN_DURATION_MS - elapsed) + SETTLE_MS;
    const t = window.setTimeout(onDone, wait);
    return () => window.clearTimeout(t);
  }, [ready, allRevealed, onDone]);

  // Hard safety: always reveal results within MAX_DURATION even if `ready`
  // never flips (e.g. a cached/instant query whose loading flag never trips).
  useEffect(() => {
    const t = window.setTimeout(onDone, MAX_DURATION_MS);
    return () => window.clearTimeout(t);
  }, [onDone]);

  // Speed the singleton particle field up while the ceremony is on screen
  // (reads as "searching the world"). The canvas keeps running; only its
  // per-frame time delta multiplier changes, so the field is continuous
  // across the hero → ceremony → results transition.
  useEffect(() => {
    particleControls.speed = 3.5;
    return () => { particleControls.speed = 1; };
  }, []);

  const activeIndex = revealed - 1;

  return (
    <div className={`search-ceremony${reduced ? ' is-reduced' : ''}`} role="status" aria-live="polite">
      {/* Ceremony-local particle layer above the opaque scrim. Passes an
          explicit `speed` so it mounts as a ONE-OFF field (always renders,
          ignores particleControls.paused) — the site singleton underneath is
          paused while the feed covers it, and without an explicit speed this
          layer would inherit that paused state and blank out. 3.5 matches the
          "searching the world" speed the ceremony sets on the singleton. */}
      <ParticleBackground speed={3.5} />

      {/* The searched products, drifting in the particle space behind the
          stage. Each tile floats on its own gentle loop; they fade in once
          results land. Capped + positioned on a scattered ring so they read
          as floating in 3D space, not a grid. */}
      {visibleFloaters > 0 && (
        <div className="sc-floaters" aria-hidden="true">
          {pool.slice(0, visibleFloaters).map((src, i) => {
            // Fixed, non-overlapping slot (stable as more fade in beside it).
            const slot = FLOATER_SLOTS_POS[i % FLOATER_SLOTS_POS.length];
            // Per-tile drift params so each floats on its own path — gentle
            // 2D bob + a touch of rotation = "floating in space".
            const dx = (i % 2 ? 1 : -1) * (5 + (i % 3) * 3); // px, alternating
            const rot = (i % 2 ? -1 : 1) * (1.5 + (i % 3));  // deg
            return (
              <span
                key={src}
                className="sc-floater"
                style={{
                  left: `${slot.x}%`,
                  top: `${slot.y}%`,
                  ['--dx' as string]: `${dx}px`,
                  ['--rot' as string]: `${rot}deg`,
                  ['--d' as string]: `${(i % 4) * 0.5}s`,
                  ['--dur' as string]: `${7 + (i % 5)}s`,
                  // Each tile fades in on mount as it joins the field.
                  ['--fade' as string]: '0s',
                } as React.CSSProperties}
              >
                <img src={src} alt="" loading="eager" decoding="async" />
              </span>
            );
          })}
        </div>
      )}
      <div className="sc-stage">
        {/* 1 — Query echo: the committed query, pinned at the top. */}
        {query && (
          <div className="sc-echo">
            <span className="sc-echo-spark" aria-hidden="true">
              <svg viewBox="0 0 100 100" width="20" height="20">
                <path d="M50 4 C54 30 70 46 96 50 C70 54 54 70 50 96 C46 70 30 54 4 50 C30 46 46 30 50 4 Z" fill="currentColor" />
              </svg>
            </span>
            <span className="sc-echo-q">{query}</span>
          </div>
        )}

        {/* 2 — Thinking: a shimmering label + the streamed step list. */}
        <div className="sc-think-label">
          <span className={finalDone ? 'sc-think-done' : 'sc-think-shimmer'}>
            {finalDone ? 'Ready' : 'Thinking'}
          </span>
        </div>

        <div className="sc-steps">
          {steps.map((s, i) => {
            if (i >= revealed) return null;
            const isDone = i < activeIndex || finalDone;
            const isActive = i === activeIndex && !finalDone;
            return (
              <div key={s} className={`sc-step${isDone ? ' is-done' : ''}${isActive ? ' is-active' : ''}`}>
                <span className="sc-step-icon" aria-hidden="true">
                  {isDone ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg className="sc-step-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
                      <path d="M12 3a9 9 0 0 1 9 9" />
                    </svg>
                  )}
                </span>
                <span className="sc-step-label">{s}</span>
              </div>
            );
          })}
        </div>

        {/* 3 — Progress thread feeding into the reveal. */}
        <div className="sc-bar" aria-hidden="true">
          <div className="sc-bar-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  );
}
