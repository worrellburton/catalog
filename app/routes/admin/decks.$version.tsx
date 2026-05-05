import { useNavigate, useParams } from '@remix-run/react';
import { useState, lazy, Suspense } from 'react';

// Deck-specific CSS only ships when a deck route is rendered. The
// deck-view stylesheet alone is ~6k lines.
import '~/styles/deck-view.css';
import '~/styles/deck-v6.css';
import '~/styles/deck-selector.css';
// admin.css carries the .proj-chart-wrap / .proj-tooltip styles that the
// v1.2 Projections slide reuses verbatim from /admin/projections.
import '~/styles/admin.css';

// Each deck variant is 400–1100 lines and only one is rendered at a time.
// Lazy-loading splits them into per-version chunks so the admin viewer
// only pulls down the bytes for the version the user actually opened.
const DeckView = lazy(() => import('~/components/DeckView'));
const DeckViewV1 = lazy(() => import('~/components/DeckViewV1'));
const DeckViewV1_1 = lazy(() => import('~/components/DeckViewV1_1'));
const DeckViewV1_2 = lazy(() => import('~/components/DeckViewV1_2'));
const DeckViewV6 = lazy(() => import('~/components/DeckViewV6'));
const DeckViewV7 = lazy(() => import('~/components/DeckViewV7'));
const DeckViewV8 = lazy(() => import('~/components/DeckViewV8'));
const DeckViewV9 = lazy(() => import('~/components/DeckViewV9'));

export default function AdminDeckViewer() {
  const { version } = useParams();
  const navigate = useNavigate();
  const [isLightMode, setIsLightMode] = useState(false);

  const back = () => navigate('/admin/decks');
  const toggleTheme = () => setIsLightMode(v => !v);
  const noop = () => { /* deck CTAs are inert inside the admin viewer */ };

  const commonProps = {
    onSeeApp: noop,
    onVisitWebsite: noop,
    onBack: back,
    isLightMode,
    onToggleTheme: toggleTheme,
  };

  const Deck =
    version === 'v5' ? DeckView :
    version === 'v6' ? DeckViewV6 :
    version === 'v7' ? DeckViewV7 :
    version === 'v8' ? DeckViewV8 :
    version === 'v9' ? DeckViewV9 :
    version === 'v1' ? DeckViewV1 :
    version === 'v1-1' ? DeckViewV1_1 :
    version === 'v1-2' ? DeckViewV1_2 :
    null;

  if (!Deck) {
    return (
      <div className="admin-page">
        <div className="admin-page-header">
          <h1>Deck not found</h1>
          <div className="admin-page-subtitle">No deck exists at version “{version}”.</div>
        </div>
        <button className="admin-btn admin-btn-secondary" onClick={back} style={{ marginTop: 12 }}>
          Back to decks
        </button>
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="admin-page" style={{ padding: 32 }}>Loading deck…</div>}>
      <Deck {...commonProps} />
    </Suspense>
  );
}
