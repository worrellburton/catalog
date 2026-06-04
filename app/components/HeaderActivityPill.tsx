// Compact activity indicator that lives in the home header on mobile, to
// the RIGHT of HeaderWalletPill. Replaces the centered top-of-screen
// toast stack on small screens — the floating toasts read as junk on a
// phone where vertical space is at a premium and the bar briefly
// obscures the "Catalog" wordmark on every event.
//
// On click: routes to /activity (the dedicated activity screen with
// creator stats + shopper self-feedback). Was previously navigating to
// the wallet; activity now has its own dedicated surface.
//
// Source of truth for "is there activity" is the same realtime + catch-up
// pipeline ActivityRealtimeToasts already runs — we just subscribe to a
// shared bus event ('catalog:activity-bump') so we don't double-poll.

import { useEffect, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { useAuth } from '~/hooks/useAuth';
import { subscribeGenerationQueue, listGenerationJobs } from '~/services/generation-queue';

export default function HeaderActivityPill() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [unseen, setUnseen] = useState(0);
  const [hasPulse, setHasPulse] = useState(false);
  // True while one of the user's generations is running. Drives the green
  // glow + the waveform↔AI-diamond icon morph so the Activity button reads
  // as "your look is being made." Lingers ~3s after the last job clears.
  const [generating, setGenerating] = useState(false);
  useEffect(() => {
    let clearTimer: number | null = null;
    const sync = () => {
      const active = listGenerationJobs().some(j => j.status === 'running');
      if (active) {
        if (clearTimer) { window.clearTimeout(clearTimer); clearTimer = null; }
        setGenerating(true);
      } else {
        // Keep the glow a beat after the job finishes ("a generation
        // has happened") before settling back to the idle waveform.
        if (clearTimer) window.clearTimeout(clearTimer);
        clearTimer = window.setTimeout(() => setGenerating(false), 3000);
      }
    };
    sync();
    const unsub = subscribeGenerationQueue(sync);
    return () => { if (clearTimer) window.clearTimeout(clearTimer); unsub(); };
  }, []);

  // The realtime/catch-up pipeline dispatches `catalog:activity-bump` on
  // every detected event. We tally an unseen count locally; tapping the
  // pill resets it and routes to /activity. Persisted across reloads so
  // a fresh page doesn't lose the unseen count from a notification that
  // arrived a moment ago.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem('catalog:activity-unseen:v1');
      if (stored) setUnseen(parseInt(stored, 10) || 0);
    } catch { /* quota */ }
    const onBump = (e: Event) => {
      const ev = e as CustomEvent<{ count?: number }>;
      const delta = Math.max(1, ev.detail?.count ?? 1);
      setUnseen(n => {
        const next = n + delta;
        try { window.localStorage.setItem('catalog:activity-unseen:v1', String(next)); } catch { /* quota */ }
        return next;
      });
      setHasPulse(true);
      window.setTimeout(() => setHasPulse(false), 1600);
    };
    window.addEventListener('catalog:activity-bump', onBump as EventListener);
    return () => window.removeEventListener('catalog:activity-bump', onBump as EventListener);
  }, []);

  if (!user?.id) return null;

  const handleClick = () => {
    setUnseen(0);
    try { window.localStorage.setItem('catalog:activity-unseen:v1', '0'); } catch { /* quota */ }
    navigate('/activity');
  };

  return (
    <button
      type="button"
      className={`header-activity-pill${unseen > 0 ? ' has-unseen' : ''}${hasPulse ? ' is-pulsing' : ''}${generating ? ' is-generating' : ''}`}
      onClick={handleClick}
      aria-label={unseen > 0 ? `${unseen} new activity events` : (generating ? 'Generating…' : 'Open activity')}
      title={generating ? 'Generating…' : 'Activity'}
    >
      <span className="header-activity-icons" aria-hidden="true">
        {/* Waveform (idle) ↔ AI diamond (while generating) — cross-faded
            by .is-generating keyframes in CSS. */}
        <svg className="hap-icon hap-icon--wave" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
        <svg className="hap-icon hap-icon--diamond" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path d="M12 2c.6 5.4 4 8.8 9.4 9.4C16 12 12.6 15.4 12 20.8 11.4 15.4 8 12 2.6 11.4 8 10.8 11.4 7.4 12 2z" />
        </svg>
      </span>
      {unseen > 0 && (
        <span className="header-activity-pill-count">{unseen > 99 ? '99+' : unseen}</span>
      )}
    </button>
  );
}
