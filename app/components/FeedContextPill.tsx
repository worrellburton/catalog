// Floating context pill for the deep-scrolled home feed. Screens past the
// hero the bottom bar has auto-hidden, so nothing on screen says WHY the
// feed looks the way it does (Women · My Size active) or offers a fast way
// back up. This pill rides under the header, names the active filters, and
// scrolls back to the top on tap. _index gates its mount to the bare home
// feed (no overlays) and its visibility to deep scroll with chrome shown.

import { memo } from 'react';

interface FeedContextPillProps {
  visible: boolean;
  /** Active filter labels, e.g. ['Women', 'My Size']. Empty = no filters. */
  filters: string[];
  onBackToTop: () => void;
}

function FeedContextPill({ visible, filters, onBackToTop }: FeedContextPillProps) {
  return (
    <button
      type="button"
      className={`feed-context-pill${visible ? ' is-visible' : ''}`}
      onClick={onBackToTop}
      aria-hidden={!visible || undefined}
      tabIndex={visible ? 0 : -1}
      aria-label={filters.length ? `Browsing ${filters.join(', ')} — back to top` : 'Back to top'}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="12" y1="19" x2="12" y2="5" />
        <polyline points="5 12 12 5 19 12" />
      </svg>
      <span className="feed-context-pill-label">
        {filters.length ? filters.join(' · ') : 'Back to top'}
      </span>
    </button>
  );
}

export default memo(FeedContextPill);
