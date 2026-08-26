// Shared header for every /style/* sub-page (settings, apply, showroom, inbox).
//
// Before this each route hand-rolled its own bar — a "← Back" text pill plus a
// bare <h1> — so no two sub-pages matched each other, let alone the main
// Catalog app. This draws the same chrome the Catalog sub-pages use (Saved,
// Profile): a round chevron back button, then a 22px title, then an optional
// slot of secondary actions pushed to the trailing edge.
import type { ReactNode } from 'react';

interface StylePageHeaderProps {
  title: ReactNode;
  onBack: () => void;
  /** Screen-reader label for the back button — say where it goes. */
  backLabel?: string;
  /** Trailing actions (e.g. cross-links between Inbox and Showroom). */
  actions?: ReactNode;
}

export function StylePageHeader({ title, onBack, backLabel = 'Back', actions }: StylePageHeaderProps) {
  return (
    <header className="su-sub-head">
      <button type="button" className="su-back su-sub-back" onClick={onBack} aria-label={backLabel}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <h1 className="su-sub-title">{title}</h1>
      {actions && <div className="su-sub-head-actions">{actions}</div>}
    </header>
  );
}
