// /admin/ui - overview cards. Each card is a deep link into a sub-
// surface (brand / search-bar). The actual config lives in those
// subroutes; this index just orients the admin.

import { Link } from '@remix-run/react';
import { type ReactElement } from 'react';

const SECTIONS: Array<{ to: string; label: string; blurb: string; icon: ReactElement }> = [
  {
    to: '/admin/ui/brand',
    label: 'Brand',
    blurb: 'Pick the typeface for the Catalog wordmark. Applies to header, password gate, landing.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7V4h16v3" />
        <path d="M9 20h6" />
        <path d="M12 4v16" />
      </svg>
    ),
  },
  {
    to: '/admin/ui/search-bar',
    label: 'Search bar',
    blurb: 'Animated border beam for the bottom search pill. Five variants - pick one or turn off.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
    ),
  },
];

export default function AdminUiIndex() {
  return (
    <div className="admin-ui-grid">
      {SECTIONS.map(s => (
        <Link key={s.to} to={s.to} className="admin-ui-card">
          <span className="admin-ui-card-icon" aria-hidden="true">{s.icon}</span>
          <div className="admin-ui-card-text">
            <span className="admin-ui-card-label">{s.label}</span>
            <span className="admin-ui-card-blurb">{s.blurb}</span>
          </div>
          <span className="admin-ui-card-chevron" aria-hidden="true">›</span>
        </Link>
      ))}
    </div>
  );
}
