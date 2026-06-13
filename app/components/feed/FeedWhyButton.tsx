// Super-admin-only "why did this show up?" button — a small, subtle
// affordance pinned center-left on every feed card. Invisible to normal
// shoppers (gated on role). On tap it lazy-loads the explainer, derives
// the placement reason from the live feed snapshot, and shows it in a
// portal panel. Zero cost to non-admins beyond this tiny component.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '~/hooks/useAuth';
import type { Look } from '~/data/looks';
import type { ProductAd } from '~/services/product-creative';
import type { FeedWhy } from '~/services/feed-why';
import { useFeedWhyAccess } from './FeedWhyContext';

export default function FeedWhyButton({ creative, look }: { creative?: ProductAd; look?: Look }) {
  const { user } = useAuth();
  const access = useFeedWhyAccess();
  const [why, setWhy] = useState<FeedWhy | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!why) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setWhy(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [why]);

  if (user?.role !== 'super_admin') return null;

  const open = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const ctx = access.get();
      const mod = await import('~/services/feed-why');
      if (!ctx) {
        setWhy({ tone: 'default', lane: 'No context', headline: 'Feed snapshot unavailable', detail: 'This card is outside the main feed (e.g. an overlay rail), so there is no ranking snapshot to explain.', facts: [] });
      } else if (look) {
        setWhy(mod.explainLook(look, ctx));
      } else if (creative) {
        setWhy(mod.explainCreative(creative, ctx));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="feed-why-btn"
        aria-label="Why did this show up?"
        title="Why did this show up? (super admin)"
        onClick={open}
        onMouseDown={e => e.stopPropagation()}
        onTouchStart={e => e.stopPropagation()}
      >
        ?
      </button>

      {why && createPortal(
        <div className="feed-why-scrim" onClick={() => setWhy(null)}>
          <div className={`feed-why-panel tone-${why.tone}`} onClick={e => e.stopPropagation()}>
            <div className="feed-why-head">
              <span className="feed-why-lane">{why.lane}</span>
              <button type="button" className="feed-why-x" aria-label="Close" onClick={() => setWhy(null)}>×</button>
            </div>
            <h3 className="feed-why-headline">{why.headline}</h3>
            <p className="feed-why-detail">{why.detail}</p>
            {why.facts.length > 0 && (
              <dl className="feed-why-facts">
                {why.facts.map((f, i) => (
                  <div key={i}><dt>{f.label}</dt><dd>{f.value}</dd></div>
                ))}
              </dl>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
