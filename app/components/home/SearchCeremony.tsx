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
  /** 2-3 demographic-aware catalog names. When present, the ceremony ends on a
   *  "or try one of these" picker instead of auto-revealing the raw results. */
  recommendations?: string[];
  /** Tapping a recommended catalog — runs THAT catalog with no second ceremony. */
  onPickCatalog?: (name: string) => void;
}

const MIN_DURATION_MS = 2400;
const MAX_DURATION_MS = 7000;
/** How many product tiles can float behind the stage at most. */
const FLOATER_SLOTS = 8;
/** Beat the gather animation needs to play out before the reveal. */
const GATHER_MS = 760;

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
// Per-slot depth: scale + drift amplitude + settled opacity. Bigger tiles
// read as closer (drift LESS, slightly more opaque); smaller as farther
// (drift more, dimmer) — together they fake a parallax volume with zero
// per-frame JS. Indexed by slot, so a tile keeps its depth for its life.
const FLOATER_DEPTH: { s: number; amp: number; o: number }[] = [
  { s: 1.08, amp: 7,  o: 0.95 }, { s: 0.86, amp: 14, o: 0.78 },
  { s: 0.94, amp: 11, o: 0.85 }, { s: 1.12, amp: 6,  o: 0.96 },
  { s: 0.90, amp: 13, o: 0.80 }, { s: 1.02, amp: 9,  o: 0.92 },
  { s: 0.88, amp: 12, o: 0.82 }, { s: 1.05, amp: 8,  o: 0.94 },
];

/** A product tile occupying one of the fixed floater slots. */
type FloaterTier = 0 | 1 | 2;
interface FloaterSlot {
  src: string;
  tier: FloaterTier;
  /** Bumped on every in-place upgrade — keys the swap animation. */
  rev: number;
  /** The image being dissolved out during an upgrade. */
  prevSrc?: string;
}

function seedSlots(initial: string[]): (FloaterSlot | null)[] {
  const out: (FloaterSlot | null)[] = Array(FLOATER_SLOTS).fill(null);
  initial.slice(0, FLOATER_SLOTS).forEach((src, i) => {
    if (src) out[i] = { src, tier: 0, rev: 0 };
  });
  return out;
}

/** Deterministic per-query position jitter (±range) so the scatter looks
 *  organic and differs between searches, but never shifts mid-ceremony. */
function slotJitter(seed: string, i: number, range: number): number {
  let h = (2166136261 ^ (i * 16777619)) >>> 0;
  for (let c = 0; c < seed.length; c++) {
    h ^= seed.charCodeAt(c);
    h = Math.imul(h, 16777619);
  }
  return (((h >>> 0) % 1000) / 1000 - 0.5) * 2 * range;
}
/** How fast the thinking steps stream in, one after another. */
const STEP_INTERVAL_MS = 600;

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

export default function SearchCeremony({ query, kind = 'search', ready, onDone, floatingImages = [], recommendations = [], onPickCatalog }: SearchCeremonyProps) {
  const steps = useRef(buildSteps(query, kind)).current;
  // How many steps are currently visible (they stream in over time).
  const [revealed, setRevealed] = useState(1);
  // When the narration finishes, if we have demographic-aware catalog picks we
  // present them here instead of auto-revealing the raw results.
  const [showRecs, setShowRecs] = useState(false);
  const showRecsRef = useRef(false);
  showRecsRef.current = showRecs;
  const [progress, setProgress] = useState(6);
  const startedAt = useRef(Date.now());
  const reduced = typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const allRevealed = revealed >= steps.length;
  // Every step gets a check once the search is in AND the narration has fully
  // streamed in; until then the last-revealed step spins as the "active" one.
  const finalDone = ready && allRevealed;

  // Products "forming" in the background, revealed progressively as each
  // phase completes. Three relevance tiers compete for the fixed slots:
  //   tier 0 — REAL search results (floatingImages) as they land
  //   tier 1 — query-related precursor (name/type/brand + catalog-tag match)
  //   tier 2 — ambient home-feed filler (only if the query matched little)
  // A better tier UPGRADES an occupied slot in place (the old image dissolves
  // out, the new one resolves in, the tile's position/drift never move) — so
  // by the reveal, the field is showing what the search actually found,
  // instead of whatever happened to fill the slots first.
  const [slots, setSlots] = useState<(FloaterSlot | null)[]>(
    () => seedSlots(floatingImages),
  );
  const placeImages = (incoming: string[], tier: FloaterTier) => setSlots(prev => {
    const used = new Set(prev.filter(Boolean).map(s => (s as FloaterSlot).src));
    let next: (FloaterSlot | null)[] | null = null;
    for (const src of incoming) {
      if (!src || used.has(src)) continue;
      const pool = next ?? prev;
      // Empty slot first; otherwise upgrade the WORST strictly-lower-tier
      // slot so real results displace fillers, never each other.
      let idx = pool.findIndex(s => s === null);
      if (idx === -1) {
        let worstTier: FloaterTier = tier;
        idx = -1;
        pool.forEach((s, i) => {
          if (s && s.tier > worstTier) { worstTier = s.tier; idx = i; }
        });
      }
      if (idx === -1) continue; // field already at-or-above this tier
      next = next ?? [...prev];
      const old = next[idx];
      next[idx] = { src, tier, rev: old ? old.rev + 1 : 0, prevSrc: old?.src };
      used.add(src);
    }
    return next ?? prev;
  });
  // The real semantic results claim slots as they land (best match).
  useEffect(() => {
    if (floatingImages.length) placeImages(floatingImages, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floatingImages]);
  // Precursor: products RELATED to the query, fetched fast so the field hints
  // at what's coming ("jeans" → denim, "shoes" → sneakers, "clean girl
  // aesthetic" → that catalog's products). Only if the query matched little
  // does the home feed top the field up — and those fillers stay marked as
  // tier 2 so real results replace them the moment they arrive.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let related: string[] = [];
      try { related = await getProductImagesForQuery(query, FLOATER_SLOTS * 2); } catch { /* */ }
      if (cancelled) return;
      if (related.length) placeImages(related, 1);
      if (related.length < 4) {
        try {
          const feed = await getHomeFeed({ ignoreGender: true });
          if (cancelled) return;
          placeImages(feed.map(a =>
            a.product?.primary_image_url || a.product?.image_url || a.thumbnail_url || '',
          ).filter(Boolean), 2);
        } catch { /* keep the query matches we have */ }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Visible tile count ramps with each completed phase (a couple per phase),
  // so the field fills in as the narration progresses.
  const phaseRatio = steps.length > 0 ? revealed / steps.length : 1;
  const visibleFloaters = Math.ceil(phaseRatio * FLOATER_SLOTS);

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
    // The hold after the last check is exactly the gather beat — the floating
    // products dive down toward where the results rise from, so the ceremony
    // hands off INTO the reveal instead of just stopping before it.
    const wait = Math.max(0, MIN_DURATION_MS - elapsed) + GATHER_MS;
    const t = window.setTimeout(() => {
      // End of the ceremony: if demographic-aware catalogs are ready, present
      // the picker; otherwise hand off straight to the raw results.
      if (recommendations.length > 0) setShowRecs(true);
      else onDone();
    }, wait);
    return () => window.clearTimeout(t);
  }, [ready, allRevealed, onDone, recommendations.length]);

  // Hard safety: always reveal results within MAX_DURATION even if `ready`
  // never flips (e.g. a cached/instant query whose loading flag never trips).
  // Skip if the recommendations picker is up — the shopper is choosing.
  useEffect(() => {
    const t = window.setTimeout(() => { if (!showRecsRef.current) onDone(); }, MAX_DURATION_MS);
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

      {/* The searched products materialising in the particle space behind the
          stage. Each tile is born at the stage's spark and flies out to its
          slot (blur-to-sharp, scale-up), then floats on a per-depth parallax
          drift. When a better-tier image claims the slot, the old one
          dissolves out and the new one resolves in WITHOUT the tile moving.
          On the final check, the whole field gathers and dives down toward
          where the results rise from. */}
      <div className={`sc-floaters${finalDone ? ' is-gather' : ''}`} aria-hidden="true">
        {slots.map((f, i) => {
          if (!f || i >= visibleFloaters) return null;
          const base = FLOATER_SLOTS_POS[i];
          const depth = FLOATER_DEPTH[i];
          // Organic per-query scatter; stable for the ceremony's lifetime.
          const x = base.x + slotJitter(query, i, 3);
          const y = base.y + slotJitter(query, i * 7 + 3, 3.5);
          return (
            <span
              key={`slot-${i}`}
              className="sc-floater"
              style={{
                left: `${x.toFixed(1)}%`,
                top: `${y.toFixed(1)}%`,
                // Spawn vector: from the stage centre out to the slot.
                ['--fx' as string]: `${(50 - x).toFixed(1)}vw`,
                ['--fy' as string]: `${(48 - y).toFixed(1)}vh`,
                // Gather vector: down past the fold, where results rise from.
                ['--gx' as string]: `${((50 - x) * 0.6).toFixed(1)}vw`,
                ['--gy' as string]: `${(112 - y).toFixed(1)}vh`,
                ['--spin' as string]: `${slotJitter(query, i + 17, 16).toFixed(0)}deg`,
                ['--s' as string]: `${depth.s}`,
                ['--amp' as string]: `${depth.amp}px`,
                ['--o' as string]: `${depth.o}`,
                ['--delay' as string]: `${(i % 4) * 0.09}s`,
                ['--gd' as string]: `${i * 0.035}s`,
                ['--dur' as string]: `${8 + (i % 5)}s`,
              } as React.CSSProperties}
            >
              {/* Dissolving previous image during an in-place upgrade. */}
              {f.prevSrc && (
                <img key={`out-${f.rev}`} className="sc-img-out" src={f.prevSrc} alt="" decoding="async" />
              )}
              <img
                key={f.src}
                className={f.rev > 0 ? 'sc-img-in' : undefined}
                src={f.src}
                alt=""
                loading="eager"
                decoding="async"
              />
              {/* One-shot ring flash when a real result claims the slot. */}
              {f.rev > 0 && <span key={`flash-${f.rev}`} className="sc-floater-flash" />}
            </span>
          );
        })}
      </div>
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

        {showRecs ? (
          /* End of ceremony: demographic-aware catalog picks. Tap one to run
             it (no second ceremony), or continue with the raw search. */
          <div className="sc-recs">
            <div className="sc-recs-hint">Made for you — tap one, or keep your search</div>
            <div className="sc-recs-list">
              {recommendations.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="sc-rec"
                  onClick={() => onPickCatalog?.(name)}
                >
                  <span className="sc-rec-spark" aria-hidden="true">
                    <svg viewBox="0 0 100 100" width="15" height="15"><path d="M50 4 C54 30 70 46 96 50 C70 54 54 70 50 96 C46 70 30 54 4 50 C30 46 46 30 50 4 Z" fill="currentColor" /></svg>
                  </span>
                  <span className="sc-rec-name">{name}</span>
                </button>
              ))}
            </div>
            <button type="button" className="sc-recs-continue" onClick={onDone}>
              Continue with &ldquo;{query}&rdquo;
            </button>
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
