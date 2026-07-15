// Shopper-visible "why you're seeing this" caption — the trust-building
// counterpart to the super-admin FeedWhyButton. Renders a single short
// line ("Because you saved Nike") over the top-left of a feed card when
// the live feed snapshot has a strong personal signal for it, and nothing
// at all otherwise. Non-interactive: pointer-events none, so taps fall
// through to the card.

import { useEffect, useState } from 'react';
import type { Look } from '~/data/looks';
import type { ProductAd } from '~/services/product-creative';
import { shopperWhyLabel } from '~/services/feed-why-shopper';
import { useFeedWhyAccess } from './FeedWhyContext';

export default function FeedWhyShopperTag({ creative, look }: { creative?: ProductAd; look?: Look }) {
  const access = useFeedWhyAccess();
  const [label, setLabel] = useState<string | null>(null);

  // The snapshot is read lazily (the provider deliberately never re-renders
  // consumers), so compute on mount and retry once shortly after — first-
  // screen cards can mount before ContinuousFeed has produced the snapshot.
  useEffect(() => {
    let timer = 0;
    const compute = () => {
      const ctx = access.get();
      if (!ctx) return false;
      setLabel(shopperWhyLabel({ creative, look }, ctx));
      return true;
    };
    if (!compute()) timer = window.setTimeout(compute, 2000);
    return () => window.clearTimeout(timer);
  }, [access, creative, look]);

  if (!label) return null;
  return <span className="card-why-tag">{label}</span>;
}
