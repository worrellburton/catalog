import type { ScenarioId } from '~/services/model-metrics';

// Toolbar above the model: one-click scenario presets + export.
export default function ModelHeadline({
  onScenario,
  onExportCsv,
  onPrint,
}: {
  onScenario: (id: ScenarioId) => void;
  onExportCsv: () => void;
  onPrint: () => void;
}) {
  return (
    <div className="model-headline">
      <div className="model-toolbar">
        <span className="model-toolbar-label">Scenario</span>
        <div className="model-scenarios">
          <button type="button" onClick={() => onScenario('bear')}>Bear</button>
          <button type="button" onClick={() => onScenario('base')}>Base</button>
          <button type="button" onClick={() => onScenario('bull')}>Bull</button>
        </div>
        <span className="model-toolbar-spacer" />
        <button className="admin-btn admin-btn-secondary" onClick={onExportCsv}>Export CSV</button>
        <button className="admin-btn admin-btn-secondary" onClick={onPrint}>Print / PDF</button>
      </div>
    </div>
  );
}
