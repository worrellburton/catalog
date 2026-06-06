// Public, unguessable link for the short investor deck. Mounted at a random
// path (see vite.config routes()) so it can't be edited toward other decks.
//
// The deck is React.lazy'd so its chunk loads on demand. React itself is
// pinned to the `react-vendor` chunk (vite.config manualChunks), so adding
// this route can't re-split React across the admin/deck chunks — the failure
// mode that previously blanked the SPA.
import { lazy, Suspense } from 'react';
import '~/styles/deck-view.css';
import '~/styles/deck-v6.css';
import '~/styles/deck-v2.css';

const DeckViewV2 = lazy(() => import('~/components/DeckViewV2'));

export default function DeckPublic() {
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
