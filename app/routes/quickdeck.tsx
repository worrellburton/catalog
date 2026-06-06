// Public, fixed link for the short investor deck: catalog.shop/quickdeck.
//
// Unlike /admin/decks/:version (admin-gated, version param editable), this
// route is public and hard-wired to one deck.
//
// IMPORTANT: the deck is loaded with React.lazy (dynamic import), NOT a
// static top-level import. A static import drags the heavy `deck` chunk into
// this root route's boot graph, which previously created a circular React
// init between the deck and admin chunks and blanked the entire SPA. Lazy
// loading keeps the deck chunk on-demand (same pattern as the admin deck
// viewer), so the boot graph is unaffected.
import { lazy, Suspense } from 'react';
import '~/styles/deck-view.css';
import '~/styles/deck-v6.css';
import '~/styles/deck-v2.css';

const DeckViewV2 = lazy(() => import('~/components/DeckViewV2'));

export default function QuickDeck() {
  const noop = () => { /* deck renders no back / theme / app CTAs */ };
  return (
    <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#000' }} />}>
      <DeckViewV2
        onSeeApp={noop}
        onVisitWebsite={noop}
        onBack={noop}
        isLightMode={false}
        onToggleTheme={noop}
      />
    </Suspense>
  );
}
