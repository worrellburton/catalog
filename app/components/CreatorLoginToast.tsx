import { useEffect, useState, useCallback } from 'react';

interface CreatorLoginToastProps {
  impressions: number;
  clicks: number;
  /** Optional ISO timestamp the counts are relative to. When null,
   *  we say "since you joined" instead of "since last login". */
  since: string | null;
  onClick: () => void;
  onDismiss: () => void;
}

/**
 * Animated welcome-back card that pops into the top-right when a
 * creator logs in. Shows the engagement they earned since their
 * last visit. Clicking the body navigates to the Analytics section
 * of the earnings page; the × dismisses silently.
 *
 * Lifecycle:
 *   - Mounts hidden, slides + fades in after first paint.
 *   - Auto-dismisses after 8s if untouched.
 *   - Click anywhere on the body → onClick().
 */
export default function CreatorLoginToast({
  impressions,
  clicks,
  since,
  onClick,
  onDismiss,
}: CreatorLoginToastProps) {
  const [phase, setPhase] = useState<'enter' | 'open' | 'leave'>('enter');

  // Trigger the slide-in on next frame so the transition fires.
  useEffect(() => {
    const t = window.setTimeout(() => setPhase('open'), 32);
    return () => window.clearTimeout(t);
  }, []);

  // Auto-dismiss after 8s so the toast doesn't linger forever if the
  // creator never interacts with it.
  useEffect(() => {
    const t = window.setTimeout(() => beginLeave(), 8000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beginLeave = useCallback(() => {
    setPhase('leave');
    window.setTimeout(onDismiss, 280);
  }, [onDismiss]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Tapping the close icon shouldn't navigate.
    if ((e.target as HTMLElement).closest('.creator-toast-close')) return;
    onClick();
    setPhase('leave');
    window.setTimeout(onDismiss, 220);
  }, [onClick, onDismiss]);

  // Headline copy adapts to whether this is a return visit or the
  // first-ever check after sign-up.
  const headline = since ? 'Welcome back' : 'Your catalog so far';
  const subline = since
    ? `Since you were last here, your looks earned:`
    : `Here's what your looks have earned so far:`;

  return (
    <div
      className={`creator-toast creator-toast--${phase}`}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(e as unknown as React.MouseEvent); }}
      aria-label="Open your earnings analytics"
    >
      <button
        type="button"
        className="creator-toast-close"
        onClick={(e) => { e.stopPropagation(); beginLeave(); }}
        aria-label="Dismiss"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>

      <div className="creator-toast-headline">{headline}</div>
      <div className="creator-toast-subline">{subline}</div>

      <div className="creator-toast-stats">
        <div className="creator-toast-stat">
          <span className="creator-toast-stat-num">{impressions.toLocaleString()}</span>
          <span className="creator-toast-stat-label">{impressions === 1 ? 'impression' : 'impressions'}</span>
        </div>
        <div className="creator-toast-stat-divider" aria-hidden="true" />
        <div className="creator-toast-stat">
          <span className="creator-toast-stat-num">{clicks.toLocaleString()}</span>
          <span className="creator-toast-stat-label">{clicks === 1 ? 'click' : 'clicks'}</span>
        </div>
      </div>

      <div className="creator-toast-cta">
        See full analytics
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    </div>
  );
}
