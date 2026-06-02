// Compact activity indicator that lives in the home header on mobile, to
// the LEFT of HeaderWalletPill. Replaces the centered top-of-screen toast
// stack on small screens — the floating toasts read as junk on a phone
// where vertical space is at a premium and the bar already obscures the
// "Catalog" wordmark briefly on every event.
//
// On click: opens the wallet (which hosts the activity feed at /earnings,
// same destination the toasts navigated to). On desktop the toasts still
// surface in the centered stack via ActivityRealtimeToasts; this pill is
// hidden via CSS (`@media (min-width: 769px)`).
//
// Source of truth for "is there activity" is the same realtime + catch-up
// pipeline ActivityRealtimeToasts already runs — we just subscribe to a
// shared bus event ('catalog:activity-bump') so we don't double-poll.

import { useEffect, useState } from 'react';
import { useAuth } from '~/hooks/useAuth';

interface HeaderActivityPillProps {
  onOpenWallet: () => void;
}

export default function HeaderActivityPill({ onOpenWallet }: HeaderActivityPillProps) {
  const { user } = useAuth();
  const [unseen, setUnseen] = useState(0);
  const [hasPulse, setHasPulse] = useState(false);

  // The realtime/catch-up pipeline dispatches `catalog:activity-bump` on
  // every detected event. We tally an unseen count locally; tapping the
  // pill resets it (and opens the wallet so the user sees the activity
  // tab). Persisted across reloads so a fresh page doesn't lose the
  // unseen count from a notification that arrived a moment ago.
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
    onOpenWallet();
  };

  return (
    <button
      type="button"
      className={`header-activity-pill${unseen > 0 ? ' has-unseen' : ''}${hasPulse ? ' is-pulsing' : ''}`}
      onClick={handleClick}
      aria-label={unseen > 0 ? `${unseen} new activity events` : 'Open activity'}
      title="Activity"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
      {unseen > 0 && (
        <span className="header-activity-pill-count">{unseen > 99 ? '99+' : unseen}</span>
      )}
    </button>
  );
}
