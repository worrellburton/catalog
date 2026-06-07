import type { ReactElement } from 'react';
import type { ScenarioId } from '~/services/model-metrics';

// Trend icons: Bear = down, Base = flat, Bull = up.
const ICONS: Record<ScenarioId, ReactElement> = {
  bear: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" /><polyline points="17 18 23 18 23 12" />
    </svg>
  ),
  base: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="12" x2="20" y2="12" />
    </svg>
  ),
  bull: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
    </svg>
  ),
};

const ORDER: { id: ScenarioId; label: string }[] = [
  { id: 'bear', label: 'Bear' },
  { id: 'base', label: 'Base' },
  { id: 'bull', label: 'Bull' },
];

// Toolbar above the model: scenario switcher (centered) + export. Only
// Base is editable; Bear/Bull are derived views.
export default function ModelHeadline({
  scenario,
  onScenario,
  onExportCsv,
  onPrint,
}: {
  scenario: ScenarioId;
  onScenario: (id: ScenarioId) => void;
  onExportCsv: () => void;
  onPrint: () => void;
}) {
  return (
    <div className="model-headline">
      <div className="model-toolbar">
        <div className="model-toolbar-left" />
        <div className="model-scenarios-group">
          <span className="model-toolbar-label">Scenario</span>
          <div className="model-scenarios">
            {ORDER.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={scenario === id ? 'is-active' : ''}
                onClick={() => onScenario(id)}
              >
                {ICONS[id]}
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="model-toolbar-right">
          <button className="admin-btn admin-btn-secondary" onClick={onExportCsv}>Export CSV</button>
          <button className="admin-btn admin-btn-secondary" onClick={onPrint}>Print / PDF</button>
        </div>
      </div>
    </div>
  );
}
