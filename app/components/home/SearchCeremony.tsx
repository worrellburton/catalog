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

// Agentic progress narration — concrete steps, streamed one by one with a
// spinner→check. The first echoes the query; the last ("Composing your
// edit") is the one that holds while the real search resolves.
function buildSteps(query: string): string[] {
  const q = query.trim();
  const subject = q.length > 32 ? `${q.slice(0, 31)}…` : q;
  return [
    subject ? `Understanding “${subject}”` : 'Understanding your request',
    'Searching the catalog',
    'Matching products & styles',
    'Ranking the best looks',
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
