// imports
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from '@remix-run/react';
import ProductActivityTimeline, { ActivityTotalsRow } from '~/components/admin/ProductActivityTimeline';
import { loadProductActivity, type ProductActivity } from '~/services/product-activity';

// types
interface ProductActivityDropdownProps {
  productId: string | null | undefined;
  createdAt: string | null | undefined;
  lookCount: number;
  impressions: number;
}

// constants
const PANEL_WIDTH = 380;
const DROPDOWN_LIMIT = 40;

// main logic
/** Activity cell: a compact summary that drops down the product's full
 *  activity — totals plus the newest events — with a link to its page. */
export default function ProductActivityDropdown({ productId, createdAt, lookCount, impressions }: ProductActivityDropdownProps) {
  const [open, setOpen] = useState(false);
  const [activity, setActivity] = useState<ProductActivity | null>(null);
  const [loading, setLoading] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open || !productId || activity) return;
    let cancelled = false;
    setLoading(true);
    loadProductActivity(productId, createdAt).then(a => {
      if (cancelled) return;
      setActivity(a);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, productId, createdAt, activity]);

  const summary = lookCount > 0 || impressions > 0
    ? [lookCount > 0 && `${lookCount} look${lookCount === 1 ? '' : 's'}`, impressions > 0 && `${impressions.toLocaleString()} seen`].filter(Boolean).join(' · ')
    : 'None yet';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`admin-activity-trigger${open ? ' is-open' : ''}`}
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        disabled={!productId}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span>{summary}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && productId && (
        <ActivityPanel anchor={triggerRef.current} onClose={() => setOpen(false)}>
          {loading || !activity ? (
            <p className="admin-activity-empty">Loading activity…</p>
          ) : (
            <>
              <ActivityTotalsRow totals={activity.totals} />
              <div className="admin-activity-scroll">
                <ProductActivityTimeline items={activity.items} limit={DROPDOWN_LIMIT} />
              </div>
              <Link className="admin-activity-more" to={`/admin/product/${productId}`}>
                {activity.items.length > DROPDOWN_LIMIT ? `See all ${activity.items.length} on the product page` : 'Open product page'} →
              </Link>
            </>
          )}
        </ActivityPanel>
      )}
    </>
  );
}

// helpers
interface ActivityPanelProps {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: React.ReactNode;
}

/** Portaled so the table's scroll container can't clip it. */
function ActivityPanel({ anchor, onClose, children }: ActivityPanelProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.right - PANEL_WIDTH), window.innerWidth - PANEL_WIDTH - 8);
    const below = r.bottom + 6;
    const top = below + 420 > window.innerHeight ? Math.max(8, r.top - 426) : below;
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onScroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchor, onClose]);

  if (typeof document === 'undefined') return null;
  const dark = !!anchor?.closest('.admin-dark');
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Product activity"
      className={`admin-activity-panel${dark ? ' is-dark' : ''}`}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: PANEL_WIDTH }}
      onClick={e => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
