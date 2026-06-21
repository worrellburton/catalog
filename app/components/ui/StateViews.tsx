// Shared loading / empty / error state primitives — the platform's one visual
// language for the three "no content right now" cases, so every surface
// degrades the same way (and errors always offer a retry) instead of going
// blank or silently failing. Styles: app/styles/state-views.css (global).
//
// Usage:
//   {loading ? <Skeleton height={180} /> : err ? <ErrorState onRetry={load} />
//     : items.length === 0 ? <EmptyState title="Nothing here yet" />
//     : <Grid items={items} />}

import type { CSSProperties, ReactNode } from 'react';

/** A shimmering placeholder block. Size it via width/height (px or any CSS
 *  length) or `style`. Respects prefers-reduced-motion (no shimmer). */
export function Skeleton({
  width = '100%',
  height = 16,
  radius,
  className = '',
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
  style?: CSSProperties;
}) {
  const px = (v: number | string) => (typeof v === 'number' ? `${v}px` : v);
  return (
    <span
      aria-hidden="true"
      className={`skeleton ${className}`}
      style={{ display: 'block', width: px(width), height: px(height), ...(radius != null ? { borderRadius: px(radius) } : null), ...style }}
    />
  );
}

interface StateProps {
  title?: string;
  body?: ReactNode;
  icon?: ReactNode;
  light?: boolean;
  className?: string;
}

/** "There's nothing here" — a calm, centered message (optionally with an icon
 *  and a call to action passed as `body`). */
export function EmptyState({ title = 'Nothing here yet', body, icon, light = false, className = '' }: StateProps) {
  return (
    <div className={`sv ${light ? 'sv--light' : ''} ${className}`} role="status">
      {icon && <div className="sv-icon">{icon}</div>}
      <div className="sv-title">{title}</div>
      {body && <div className="sv-body">{body}</div>}
    </div>
  );
}

/** "Something went wrong" — ALWAYS offers a retry so a transient failure is one
 *  tap from recovery (most data fetches across the app have no retry today). */
export function ErrorState({
  title = 'Something went wrong',
  body = 'That didn’t load. Give it another try.',
  onRetry,
  retryLabel = 'Try again',
  light = false,
  className = '',
}: StateProps & { onRetry?: () => void; retryLabel?: string }) {
  return (
    <div className={`sv ${light ? 'sv--light' : ''} ${className}`} role="alert">
      <div className="sv-title">{title}</div>
      {body && <div className="sv-body">{body}</div>}
      {onRetry && (
        <button type="button" className="sv-retry" onClick={onRetry}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          {retryLabel}
        </button>
      )}
    </div>
  );
}
