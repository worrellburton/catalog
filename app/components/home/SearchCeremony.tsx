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
import { particleControls } from '~/services/particles';
// ParticleBackground lives in the app root (SiteParticleHost). Here we
// just dial up its speed for the "searching the world" moment, then
// restore it on cleanup — the canvas itself never re-mounts so the field
// stays continuous across the search transition.

interface SearchCeremonyProps {
  query: string;
  /** True once the real search results are in hand. */
  ready: boolean;
  /** Fired once the narration has played out AND ready is true. */
  onDone: () => void;
}

const MIN_DURATION_MS = 2400;
const MAX_DURATION_MS = 7000;
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

function buildSteps(query: string): string[] {
  const q = query.trim();
  const subject = q.length > 32 ? `${q.slice(0, 31)}…` : q;
  // Roughly 50/50 split — two from each pool, shuffled, sliced to three.
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

export default function SearchCeremony({ query, ready, onDone }: SearchCeremonyProps) {
  const steps = useRef(buildSteps(query)).current;
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
      setProgress(p => {
        const target = finalDone ? 100 : Math.min(88, 12 + revealed * 16);
        const next = p + (target - p) * (finalDone ? 0.25 : 0.06);
        return next > 99.5 ? 100 : next;
      });
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
