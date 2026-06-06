import type { InvestorMetrics, ScenarioId } from '~/services/model-metrics';
import { fmtCurrency } from '~/services/projections';

// The deck strip: one-click scenario presets, export, and the metrics an
// investor asks for first — exit ARR, LTV:CAC, payback, runway, burn, GMV.
export default function ModelHeadline({
  m,
  onScenario,
  onExportCsv,
  onPrint,
}: {
  m: InvestorMetrics;
  onScenario: (id: ScenarioId) => void;
  onExportCsv: () => void;
  onPrint: () => void;
}) {
  const chip = (label: string, value: string, sub?: string, tone?: 'good' | 'warn') => (
    <div className={`model-chip${tone ? ` model-chip-${tone}` : ''}`}>
      <span className="model-chip-label">{label}</span>
      <span className="model-chip-value">{value}</span>
      {sub && <span className="model-chip-sub">{sub}</span>}
    </div>
  );

  const runwayTone: 'good' | 'warn' = m.runwayMonths == null ? 'good' : 'warn';
  const ltvTone: 'good' | 'warn' = m.ltvCac >= 3 ? 'good' : 'warn';

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
      <div className="model-chips">
        {chip('Exit ARR', fmtCurrency(m.exitArr))}
        {chip('LTV : CAC', `${m.ltvCac.toFixed(1)}×`, m.ltvCac >= 3 ? 'healthy (≥3×)' : 'below 3×', ltvTone)}
        {chip('LTV', fmtCurrency(m.ltv))}
        {chip('CAC payback', `${m.paybackMonths.toFixed(1)} mo`)}
        {chip('Runway', m.runwayMonths == null ? '16+ mo' : `${m.runwayMonths} mo`, m.runwayMonths == null ? 'survives horizon' : 'cash-out', runwayTone)}
        {chip('Avg burn', `${fmtCurrency(m.avgBurn, { compact: true })}/mo`)}
        {chip('GMV (16mo)', fmtCurrency(m.gmvTotal))}
      </div>
    </div>
  );
}
