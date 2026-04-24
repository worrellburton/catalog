import { useNavigate, useParams } from '@remix-run/react';
import { useState } from 'react';
import DeckView from '~/components/DeckView';
import DeckViewV1 from '~/components/DeckViewV1';
import DeckViewV1_1 from '~/components/DeckViewV1_1';
import DeckViewV6 from '~/components/DeckViewV6';
import DeckViewV7 from '~/components/DeckViewV7';
import DeckViewV8 from '~/components/DeckViewV8';
import DeckViewV9 from '~/components/DeckViewV9';

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

  if (version === 'v5') return <DeckView {...commonProps} />;
  if (version === 'v6') return <DeckViewV6 {...commonProps} />;
  if (version === 'v7') return <DeckViewV7 {...commonProps} />;
  if (version === 'v8') return <DeckViewV8 {...commonProps} />;
  if (version === 'v9') return <DeckViewV9 {...commonProps} />;
  if (version === 'v1') return <DeckViewV1 {...commonProps} />;
  if (version === 'v1-1') return <DeckViewV1_1 {...commonProps} />;

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
