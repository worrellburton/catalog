// SearchCeremony — the AI-style "querying the world" loading screen shown
// between a hero search and the results. Rotating playful/magical lines, a
// living progress bar, and an orbiting mark. It runs for at least
// MIN_DURATION so the moment always feels intentional, and stays up until
// the real search has resolved (the parent flips `ready`); then it calls
// onDone and the results animate in.

import { useEffect, useRef, useState } from 'react';

interface SearchCeremonyProps {
  query: string;
  /** True once the real search results are in hand. */
  ready: boolean;
  /** Fired once both the minimum duration has elapsed AND ready is true. */
  onDone: () => void;
}

const MIN_DURATION_MS = 2400;

// Playful & magical (the tone picked). Rotated every ~1.1s.
const MESSAGES = [
  'Combobulating the catalog',
  'Conjuring your edit',
  'Searching the world for what you want',
  'Working a little magic',
  'Pulling the perfect pieces',
  'Styling it up',
];

export default function SearchCeremony({ query, ready, onDone }: SearchCeremonyProps) {
  const [msgIndex, setMsgIndex] = useState(0);
  const [progress, setProgress] = useState(6);
  const startedAt = useRef(Date.now());
  const reduced = typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Rotate the messages.
  useEffect(() => {
    const t = window.setInterval(() => setMsgIndex(i => (i + 1) % MESSAGES.length), 1100);
    return () => window.clearInterval(t);
  }, []);

  // Drive the progress bar: ease toward 90% while waiting; snap to 100%
  // the moment we're ready, then bow out.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setProgress(p => {
        const target = ready ? 100 : 90;
        const next = p + (target - p) * (ready ? 0.25 : 0.04);
        return next > 99.5 ? 100 : next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  // Exit when the floor has passed AND results are ready.
  useEffect(() => {
    if (!ready) return;
    const elapsed = Date.now() - startedAt.current;
    const wait = Math.max(0, MIN_DURATION_MS - elapsed);
    const t = window.setTimeout(onDone, wait + 280); // +280 lets the bar finish
    return () => window.clearTimeout(t);
  }, [ready, onDone]);

  return (
    <div className={`search-ceremony${reduced ? ' is-reduced' : ''}`} role="status" aria-live="polite">
      <div className="sc-stage">
        <div className="sc-orb" aria-hidden="true">
          <span className="sc-orb-ring" />
          <span className="sc-orb-ring sc-orb-ring--2" />
          <span className="sc-orb-core" />
        </div>

        <div className="sc-messages">
          {MESSAGES.map((m, i) => (
            <span key={m} className={`sc-message${i === msgIndex ? ' is-active' : ''}`}>{m}…</span>
          ))}
        </div>

        {query && <div className="sc-query">“{query}”</div>}

        <div className="sc-bar" aria-hidden="true">
          <div className="sc-bar-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  );
}
