// Global generation queue panel. Mounted at app root so any in-flight
// AI job — wherever it was kicked off (admin Data, /generate, the
// consumer app) — shows up here with a live progress bar driven by the
// kind's rolling average duration. Catalog-brand glass card, bottom-
// right. Auto-hides when there's nothing to show.

import { useEffect, useState } from 'react';
import { listGenerationJobs, subscribeGenerationQueue, type GenerationJob } from '~/services/generation-queue';

export default function GenerationQueueHost() {
  const [jobs, setJobs] = useState<GenerationJob[]>(listGenerationJobs());
  const [now, setNow] = useState(Date.now());

  // Subscribe to the bus.
  useEffect(() => subscribeGenerationQueue(() => setJobs(listGenerationJobs())), []);

  // Tick once a second while any job is running so the progress bars
  // animate without per-row timers.
  useEffect(() => {
    if (jobs.every(j => j.status !== 'running')) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [jobs]);

  if (jobs.length === 0) return null;
  return (
    <div className="gen-queue" role="status" aria-live="polite">
      <div className="gen-queue-head">
        <span className="gen-queue-dot" aria-hidden />
        <span className="gen-queue-title">Generation Queue</span>
        <span className="gen-queue-count">{jobs.filter(j => j.status === 'running').length} running</span>
      </div>
      <div className="gen-queue-list">
        {jobs.map(j => <GenerationRow key={j.id} job={j} now={now} />)}
      </div>
    </div>
  );
}

function GenerationRow({ job, now }: { job: GenerationJob; now: number }) {
  const elapsed = (job.endedAt ?? now) - job.startedAt;
  // Cap visual progress at 96% while still running so the bar doesn't
  // look "done" before the call returns. Once finished/failed, snap
  // to 100% for visual closure.
  const ratio = job.status === 'running'
    ? Math.min(0.96, elapsed / Math.max(1, job.estimatedMs))
    : 1;
  const pct = Math.round(ratio * 100);
  const overEstimate = job.status === 'running' && elapsed > job.estimatedMs;
  // Time-remaining label. "<1s" once we're past the estimate (or close)
  // so we don't show negative numbers, "Finalising…" once we hit the cap.
  const remaining = job.status === 'running'
    ? formatRemaining(Math.max(0, job.estimatedMs - elapsed), overEstimate)
    : (job.status === 'done' ? 'Done' : 'Failed');
  return (
    <div className={`gen-queue-row gen-queue-row--${job.status}`}>
      {job.thumbnailUrl && (
        <img className="gen-queue-thumb" src={job.thumbnailUrl} alt="" />
      )}
      <div className="gen-queue-row-body">
        <div className="gen-queue-row-head">
          <span className="gen-queue-label">{job.label}</span>
          <span className="gen-queue-remaining">{remaining}</span>
        </div>
        {job.context && <div className="gen-queue-context">{job.context}</div>}
        <div className="gen-queue-bar" aria-hidden>
          <div className={`gen-queue-bar-fill${overEstimate ? ' is-over' : ''}`} style={{ width: `${pct}%` }} />
        </div>
        {job.resultMessage && (
          <div className={`gen-queue-result${job.status === 'failed' ? ' is-err' : ''}`}>{job.resultMessage}</div>
        )}
      </div>
    </div>
  );
}

function formatRemaining(ms: number, overEstimate: boolean): string {
  if (overEstimate) return 'Finalising…';
  if (ms < 1000) return '<1s';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s left`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return rs === 0 ? `${m}m left` : `${m}m ${rs}s left`;
}
