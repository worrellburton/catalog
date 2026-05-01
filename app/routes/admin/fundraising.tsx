import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from '@remix-run/react';

type Section = 'pitch';
type PitchLength = '30' | '60';

interface Phase {
  title: string;
  description: string;
  // Minutes allotted for this phase. Total of all 10 must equal the
  // pitch length (30 or 60).
  minutes: number;
}

const AGENDA_30: Phase[] = [
  {
    title: 'Welcome & introductions',
    description:
      'Quick handshake. Confirm who is on the call, names, roles, and what the investor wants to get out of the next 30 minutes.',
    minutes: 1,
  },
  {
    title: 'The problem',
    description:
      'The pain we solve, who feels it, and why now. One vivid customer anecdote — keep it concrete, not abstract.',
    minutes: 2,
  },
  {
    title: 'Demo: the product in 90 seconds',
    description:
      'Show the live app. Open one look, save a product, click out. Narrate the wedge. No slides during demo.',
    minutes: 5,
  },
  {
    title: 'Market opportunity',
    description:
      'TAM / SAM / SOM in one slide. Anchor with a comparable category transition (TikTok → Shop, Pinterest → boards, etc.).',
    minutes: 2,
  },
  {
    title: 'Traction & metrics',
    description:
      'Weekly active shoppers, looks generated, clickout volume, revenue runrate. Show the trend, not just the latest number.',
    minutes: 4,
  },
  {
    title: 'Business model',
    description:
      'Affiliate take rate today, ad inventory tomorrow, partner subscription floor. Walk a single $X spend through to net revenue.',
    minutes: 2,
  },
  {
    title: 'Competitive landscape',
    description:
      'Who is in the lane, where they fall short, and why our wedge (creator-led catalogs, AI generation) is hard to copy.',
    minutes: 2,
  },
  {
    title: 'Team',
    description:
      'Founders, key hires, what each of us has shipped before. Ten seconds per person — they can read the bio later.',
    minutes: 2,
  },
  {
    title: 'The ask & use of funds',
    description:
      'Round size, lead terms (if any), runway it buys, and the 4–6 milestones we hit before the next raise.',
    minutes: 3,
  },
  {
    title: 'Q&A and next steps',
    description:
      'Open the floor. Capture every question — written down — and end with a concrete ask: data room, follow-up call, or partner intro.',
    minutes: 7,
  },
];

const AGENDA_60: Phase[] = [
  {
    title: 'Welcome & rapport',
    description:
      'Catch up briefly. Connect on a mutual contact or recent investment. Set the agenda explicitly so the investor knows the arc.',
    minutes: 3,
  },
  {
    title: 'Founder story & why now',
    description:
      'How we ended up working on this. The conviction, the unfair advantage, and why this window is open today and not in 2019 or 2030.',
    minutes: 5,
  },
  {
    title: 'The problem, in depth',
    description:
      'Three customer archetypes, what their journey looks like today, and where the friction lives. Real quotes beat slides.',
    minutes: 5,
  },
  {
    title: 'Live product demo',
    description:
      'Full walkthrough — feed, look detail, product page, search, generate flow. Pause for the investor to drive if they want.',
    minutes: 10,
  },
  {
    title: 'Market sizing & opportunity',
    description:
      'Bottom-up calc: shoppers × sessions × take rate. Cross-check with comparable creator-commerce platforms and category benchmarks.',
    minutes: 5,
  },
  {
    title: 'Traction, growth & key metrics',
    description:
      'Cohort retention, week-over-week growth, GMV through-flow. Call out the inflection point and what triggered it.',
    minutes: 8,
  },
  {
    title: 'Business model & unit economics',
    description:
      'CAC, LTV, payback, contribution margin. The path from take-rate-only today to multi-product (ads + subscription) over 18 months.',
    minutes: 5,
  },
  {
    title: 'Competitive moat',
    description:
      'Data flywheel, creator network, brand integrations, AI tooling. Why each compounds. Address obvious threats head-on.',
    minutes: 4,
  },
  {
    title: 'Team & advisors',
    description:
      'Founders + leadership + advisors. The hires we already have signed and the next two we plan to make with the round.',
    minutes: 3,
  },
  {
    title: 'Ask, milestones & Q&A',
    description:
      'Round size, terms, what the capital unlocks, and the milestones we commit to. Long open Q&A — make it a real conversation.',
    minutes: 12,
  },
];

function formatClock(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? '-' : '';
  const s = Math.abs(totalSeconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${sign}${m}:${String(sec).padStart(2, '0')}`;
}

interface PhaseTrackerProps {
  agenda: Phase[];
  storageKey: string;
}

// Phase tracker: drives a 10-phase pitch in real time. One phase is
// "active" at a time. When its timer hits 0, it auto-completes and the
// next phase becomes active. State persists per agenda (30 vs 60) in
// localStorage so a refresh doesn't lose the run.
function PhaseTracker({ agenda, storageKey }: PhaseTrackerProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [running, setRunning] = useState(false);
  // Seconds remaining in the active phase. Goes negative if the user
  // lets it run over (so over-runs are visible, not clamped).
  const [secondsLeft, setSecondsLeft] = useState(agenda[0].minutes * 60);
  const [completed, setCompleted] = useState<boolean[]>(() => agenda.map(() => false));

  // Hydrate from localStorage so a refresh / tab switch doesn't restart
  // the run. We deliberately don't restore `running` — the user has to
  // resume explicitly to avoid surprise time-burn after a refresh.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        activeIndex: number;
        secondsLeft: number;
        completed: boolean[];
      };
      if (typeof saved.activeIndex === 'number' && saved.activeIndex < agenda.length) {
        setActiveIndex(saved.activeIndex);
      }
      if (typeof saved.secondsLeft === 'number') {
        setSecondsLeft(saved.secondsLeft);
      }
      if (Array.isArray(saved.completed) && saved.completed.length === agenda.length) {
        setCompleted(saved.completed);
      }
    } catch { /* corrupted state — start fresh */ }
  }, [storageKey, agenda.length]);

  // Persist on every change so refresh recovers the in-flight run.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ activeIndex, secondsLeft, completed }),
      );
    } catch { /* quota — skip */ }
  }, [storageKey, activeIndex, secondsLeft, completed]);

  // Tick the active phase every second. We use Date.now() deltas so a
  // throttled tab (browser background timer slowdown) doesn't drift the
  // clock — when the tab wakes back up the elapsed time is correct.
  const lastTickRef = useRef<number | null>(null);
  useEffect(() => {
    if (!running) {
      lastTickRef.current = null;
      return;
    }
    lastTickRef.current = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      const last = lastTickRef.current ?? now;
      const elapsed = Math.round((now - last) / 1000);
      if (elapsed <= 0) return;
      lastTickRef.current = now;
      setSecondsLeft(prev => prev - elapsed);
    }, 500);
    return () => window.clearInterval(id);
  }, [running]);

  const advanceTo = useCallback((nextIndex: number) => {
    if (nextIndex >= agenda.length) {
      setRunning(false);
      setActiveIndex(agenda.length - 1);
      return;
    }
    setActiveIndex(nextIndex);
    setSecondsLeft(agenda[nextIndex].minutes * 60);
  }, [agenda]);

  // Auto-advance when the timer crosses zero — but only by one phase
  // per tick, so back-to-back zero seconds don't skip phases.
  const advancedForRef = useRef<number | null>(null);
  useEffect(() => {
    if (!running) return;
    if (secondsLeft > 0) return;
    if (advancedForRef.current === activeIndex) return;
    advancedForRef.current = activeIndex;
    setCompleted(prev => prev.map((v, i) => (i === activeIndex ? true : v)));
    advanceTo(activeIndex + 1);
  }, [running, secondsLeft, activeIndex, advanceTo]);

  const totalMinutes = useMemo(() => agenda.reduce((s, p) => s + p.minutes, 0), [agenda]);
  const completedCount = completed.filter(Boolean).length;
  const allDone = completedCount === agenda.length;

  const handleStart = () => {
    if (allDone) return;
    setRunning(true);
  };
  const handlePause = () => setRunning(false);
  const handleSkip = () => {
    setCompleted(prev => prev.map((v, i) => (i === activeIndex ? true : v)));
    advanceTo(activeIndex + 1);
    advancedForRef.current = activeIndex + 1;
  };
  const handleReset = () => {
    setRunning(false);
    setActiveIndex(0);
    setSecondsLeft(agenda[0].minutes * 60);
    setCompleted(agenda.map(() => false));
    advancedForRef.current = null;
  };

  return (
    <div className="fr-tracker">
      <div className="fr-tracker-bar">
        <div className="fr-tracker-progress">
          <div className="fr-tracker-progress-label">
            Phase {activeIndex + 1} of {agenda.length}
            <span className="fr-tracker-progress-meta">
              · {completedCount}/{agenda.length} done · {totalMinutes} min total
            </span>
          </div>
          <div className="fr-tracker-bar-track">
            <div
              className="fr-tracker-bar-fill"
              style={{ width: `${(completedCount / agenda.length) * 100}%` }}
            />
          </div>
        </div>
        <div className="fr-tracker-clock">
          <span className={`fr-tracker-time ${secondsLeft < 0 ? 'over' : ''}`}>
            {formatClock(secondsLeft)}
          </span>
          <div className="fr-tracker-controls">
            {!running && !allDone && (
              <button className="admin-btn admin-btn-primary" onClick={handleStart}>
                {completedCount === 0 && activeIndex === 0 ? 'Start' : 'Resume'}
              </button>
            )}
            {running && (
              <button className="admin-btn admin-btn-secondary" onClick={handlePause}>Pause</button>
            )}
            <button
              className="admin-btn admin-btn-secondary"
              onClick={handleSkip}
              disabled={allDone}
              title="Mark this phase complete and advance"
            >
              Next phase
            </button>
            <button
              className="admin-btn admin-btn-secondary"
              onClick={handleReset}
              title="Clear all progress"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <ol className="fr-phase-list">
        {agenda.map((phase, i) => {
          const isActive = i === activeIndex && !allDone;
          const isDone = completed[i];
          const stateClass = isActive ? 'is-active' : isDone ? 'is-done' : 'is-upcoming';
          return (
            <li key={i} className={`fr-phase ${stateClass}`}>
              <div className="fr-phase-marker">
                <span className="fr-phase-num">{isDone ? '✓' : i + 1}</span>
              </div>
              <div className="fr-phase-body">
                <div className="fr-phase-head">
                  <h3 className="fr-phase-title">{phase.title}</h3>
                  <span className="fr-phase-minutes">{phase.minutes} min</span>
                </div>
                <p className="fr-phase-desc">{phase.description}</p>
                {isActive && (
                  <div className="fr-phase-active-meta">
                    <span className={`fr-phase-time ${secondsLeft < 0 ? 'over' : ''}`}>
                      {formatClock(secondsLeft)} {secondsLeft < 0 ? 'over' : 'remaining'}
                    </span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {allDone && (
        <div className="fr-tracker-done">
          All ten phases complete. Pitch wrapped — capture follow-ups while it&apos;s fresh.
        </div>
      )}
    </div>
  );
}

export default function AdminFundraising() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSection = (searchParams.get('section') as Section | null) || 'pitch';
  const section: Section = urlSection === 'pitch' ? 'pitch' : 'pitch';
  const urlPitch = (searchParams.get('pitch') as PitchLength | null) || '30';
  const pitchLength: PitchLength = urlPitch === '60' ? '60' : '30';

  const setSection = useCallback((next: Section) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      if (next === 'pitch') p.delete('section');
      else p.set('section', next);
      return p;
    }, { replace: false });
  }, [setSearchParams]);

  const setPitchLength = useCallback((next: PitchLength) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      if (next === '30') p.delete('pitch');
      else p.set('pitch', next);
      return p;
    }, { replace: false });
  }, [setSearchParams]);

  const agenda = pitchLength === '30' ? AGENDA_30 : AGENDA_60;

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Fundraising</h1>
        <p className="admin-page-subtitle">Central hub for fundraising operations — pitch agendas, materials, and progress.</p>
      </div>

      <div className="admin-tabs" style={{ marginBottom: 16 }}>
        <button
          className={`admin-tab ${section === 'pitch' ? 'active' : ''}`}
          onClick={() => setSection('pitch')}
        >
          Pitch
        </button>
      </div>

      {section === 'pitch' && (
        <>
          <div className="admin-tabs" style={{ marginBottom: 20 }}>
            <button
              className={`admin-tab ${pitchLength === '30' ? 'active' : ''}`}
              onClick={() => setPitchLength('30')}
              title="Tight 30-minute investor meeting"
            >
              30 min pitch
            </button>
            <button
              className={`admin-tab ${pitchLength === '60' ? 'active' : ''}`}
              onClick={() => setPitchLength('60')}
              title="Full 60-minute partner meeting"
            >
              60 min pitch
            </button>
          </div>

          <PhaseTracker
            key={pitchLength}
            agenda={agenda}
            storageKey={`admin:fundraising:pitch:${pitchLength}`}
          />
        </>
      )}
    </div>
  );
}
