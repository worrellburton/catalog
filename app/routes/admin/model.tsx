import { useCallback } from 'react';
import { useSearchParams } from '@remix-run/react';
import ProjectionsPanel from '~/components/model/ProjectionsPanel';
import GoToMarketPanel from '~/components/model/GoToMarketPanel';

// The financial model. Two tabs share this shell:
//   • Projections — the 16-month revenue curve (lives in ProjectionsPanel)
//   • Go to Market — the acquisition / budget model (GoToMarketPanel)
// Tab is driven by ?tab= so it's deep-linkable from search / the deck.

type Tab = 'projections' | 'gtm';
const isTab = (v: string | null): v is Tab => v === 'projections' || v === 'gtm';

export default function AdminModel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = isTab(searchParams.get('tab')) ? (searchParams.get('tab') as Tab) : 'projections';

  const setTab = useCallback((next: Tab) => {
    setSearchParams(prev => {
      const out = new URLSearchParams(prev);
      if (next === 'projections') out.delete('tab');
      else                        out.set('tab', next);
      return out;
    }, { replace: false });
  }, [setSearchParams]);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Model</h1>
        <p className="admin-page-subtitle">The financial model — revenue projections and the go-to-market plan.</p>
      </div>

      <div className="admin-tabs" style={{ marginBottom: 4 }}>
        <button className={`admin-tab ${tab === 'projections' ? 'active' : ''}`} onClick={() => setTab('projections')}>
          Projections
        </button>
        <button className={`admin-tab ${tab === 'gtm' ? 'active' : ''}`} onClick={() => setTab('gtm')}>
          Go to Market
        </button>
      </div>

      {tab === 'projections' ? <ProjectionsPanel /> : <GoToMarketPanel />}
    </div>
  );
}
