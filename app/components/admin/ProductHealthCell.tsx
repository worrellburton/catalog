// imports
import type { MouseEvent } from 'react';
import { formatDateAdded } from '~/utils/data-format';
import type { HealthLevel, ProductHealth } from '~/utils/product-health';

// types
interface ProductHealthCellProps {
  health: ProductHealth;
  url: string | null | undefined;
  urlStatus: number | null | undefined;
  urlCheckedAt: string | null | undefined;
  rechecking: boolean;
  onRecheck?: () => void;
}

// constants
const LEVEL_LABEL: Record<HealthLevel, string> = { ok: 'Healthy', warn: 'Check', fail: 'Fix' };

// helpers
function stop(e: MouseEvent) { e.stopPropagation(); }

function statusText(status: number | null | undefined): string {
  if (status == null) return '';
  if (status === -1) return 'not fetched';
  if (status === -2) return 'no response';
  if (status === -3) return 'redirected to home/search';
  return `HTTP ${status}`;
}

// main logic
/**
 * The Health column: one pill (Healthy / Check / Fix) plus four dots — media,
 * name & brand, price, link. Hover for each check's detail, when the link was
 * last checked, and a Re-check button that runs the link checker now.
 */
export default function ProductHealthCell({ health, url, urlStatus, urlCheckedAt, rechecking, onRecheck }: ProductHealthCellProps) {
  const failing = health.checks.filter(c => c.level !== 'ok').length;
  return (
    <div className={`admin-health admin-health--${health.level}`} tabIndex={0} onClick={stop} aria-label={`Health: ${LEVEL_LABEL[health.level]}`}>
      <span className="admin-health-pill">
        {LEVEL_LABEL[health.level]}
        {failing > 0 && <span className="admin-health-count">{failing}</span>}
      </span>
      <span className="admin-health-dots" aria-hidden="true">
        {health.checks.map(c => <i key={c.key} className={`admin-health-dot is-${c.level}`} title={`${c.label}: ${c.detail}`} />)}
      </span>
      <div className="admin-health-panel" role="tooltip">
        {health.checks.map(c => (
          <div key={c.key} className="admin-health-row">
            <i className={`admin-health-dot is-${c.level}`} aria-hidden="true" />
            <span className="admin-health-label">{c.label}</span>
            <span className="admin-health-detail">{c.detail}</span>
          </div>
        ))}
        <div className="admin-health-foot">
          <span>
            {urlCheckedAt
              ? <>Link checked {formatDateAdded(urlCheckedAt)}{urlStatus != null && <> · {statusText(urlStatus)}</>}</>
              : 'Link not checked yet'}
          </span>
          {url && onRecheck && (
            <button type="button" className="admin-health-recheck" disabled={rechecking} onClick={(e) => { e.stopPropagation(); onRecheck(); }}>
              {rechecking ? 'Checking…' : 'Re-check link'}
            </button>
          )}
        </div>
        {health.link === 'blocked' && (
          <p className="admin-health-note">
            This retailer refuses automated requests, so the checker can’t confirm the page. It usually opens fine in a browser.
          </p>
        )}
      </div>
    </div>
  );
}
