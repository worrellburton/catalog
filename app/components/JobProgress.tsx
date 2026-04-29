import { useEffect, useState } from 'react';

// Shared progress indicator for all Modal-backed agent jobs (crawls,
// scrapes, video gens). Renders as a compact two-line cell that fits
// inside the existing admin tables in place of a flat status badge:
//   ┌──────────────────────────────────┐
//   │ GENERATING            ~1:24 left │
//   │ ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░ │
//   └──────────────────────────────────┘
// When elapsed exceeds `estimatedSeconds * stuckMultiplier` we flip
// into a "stuck" state and surface a manual rerun button — the Modal
// trigger is a fire-and-forget POST so jobs occasionally never start.

export type JobPhase = 'queued' | 'active' | 'stuck';

interface JobProgressProps {
  /** The raw status string from the row (used for the label). */
  status: string;
  /** Timestamp work began. Falls back to createdAt when null. */
  startedAt?: string | null;
  /** Insert/queue time — used when the row hasn't started yet. */
  createdAt: string;
  /** Typical wall-clock duration in seconds. */
  estimatedSeconds: number;
  /** When true, render as "queued/waiting" instead of "in progress". */
  isQueued?: boolean;
  /** Multiplier of `estimatedSeconds` after which we flag as stuck. Default 2. */
  stuckMultiplier?: number;
  /** If provided, a rerun button appears once the job is stuck. */
  onRerun?: () => void;
  rerunning?: boolean;
  /** Optional extra label suffix, e.g. " — sitemap" */
  detail?: string;
}

const PALETTE = {
  queued:  { fg: '#f59e0b', track: '#fde68a', bar: '#f59e0b' },
  active:  { fg: '#1d4ed8', track: '#dbeafe', bar: 'linear-gradient(90deg, #3b82f6, #8b5cf6)' },
  stuck:   { fg: '#dc2626', track: '#fecaca', bar: '#dc2626' },
};

function fmtRemaining(seconds: number): string {
  if (seconds <= 0) return 'Finishing…';
  if (seconds < 60) return `~${Math.ceil(seconds)}s left`;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `~${m}:${String(s).padStart(2, '0')} left`;
}

function fmtElapsed(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function JobProgress({
  status,
  startedAt,
  createdAt,
  estimatedSeconds,
  isQueued = false,
  stuckMultiplier = 2,
  onRerun,
  rerunning = false,
  detail,
}: JobProgressProps) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const anchor = startedAt || createdAt;
  const elapsed = Math.max(0, (now - new Date(anchor).getTime()) / 1000);
  const stuckAt = estimatedSeconds * stuckMultiplier;
  const isStuck = elapsed > stuckAt;

  const phase: JobPhase = isStuck ? 'stuck' : isQueued ? 'queued' : 'active';
  const colors = PALETTE[phase];

  // Progress curve: queued caps at 15% (so the bar is visible but
  // doesn't claim work that hasn't started); active eases past 95%
  // so it never sits at 100% while we're still polling; stuck pins
  // at 100% in a red track to make it loud.
  let pct: number;
  if (phase === 'stuck') {
    pct = 100;
  } else if (phase === 'queued') {
    pct = Math.min(15, (elapsed / 30) * 15);
  } else {
    pct = Math.min(95, (elapsed / estimatedSeconds) * 100);
  }

  const remaining = Math.max(0, estimatedSeconds - elapsed);

  let timeLabel: string;
  if (phase === 'stuck') {
    timeLabel = `Stuck • ${fmtElapsed(elapsed)}`;
  } else if (phase === 'queued') {
    timeLabel = elapsed < 60 ? 'Queued…' : `Queued • ${fmtElapsed(elapsed)}`;
  } else {
    timeLabel = fmtRemaining(remaining);
  }

  const label = (isQueued ? 'Queued' : status).toUpperCase();

  return (
    <div style={{ minWidth: 140 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3, gap: 6 }}>
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: colors.fg,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {label}{detail ? ` ${detail}` : ''}
        </span>
        <span style={{ fontSize: 10, color: phase === 'stuck' ? colors.fg : '#888', whiteSpace: 'nowrap' }}>
          {timeLabel}
        </span>
      </div>
      <div style={{
        position: 'relative',
        height: 4,
        borderRadius: 4,
        background: colors.track,
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute',
          inset: 0,
          width: `${pct}%`,
          background: colors.bar,
          transition: 'width 1s ease',
        }} />
        {phase === 'active' && (
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)',
            animation: 'admin-shimmer 1.4s infinite',
          }} />
        )}
      </div>
      {phase === 'stuck' && onRerun && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRerun(); }}
          disabled={rerunning}
          style={{
            marginTop: 6,
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 4,
            border: '1px solid #fca5a5',
            background: '#fef2f2',
            color: '#b91c1c',
            cursor: rerunning ? 'default' : 'pointer',
            opacity: rerunning ? 0.6 : 1,
          }}
        >
          {rerunning ? 'Rerunning…' : '↺ Rerun'}
        </button>
      )}
    </div>
  );
}
