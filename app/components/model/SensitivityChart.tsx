import type { SensitivityRow } from '~/services/model-metrics';
import { fmtCurrency } from '~/services/projections';

// Tornado: how much exit-ARR swings when each lever moves ±20%. Sorted
// by swing so the biggest risk/opportunity drivers sit on top.
export default function SensitivityChart({ rows }: { rows: SensitivityRow[] }) {
  const max = Math.max(1, ...rows.map(r => r.swing));
  return (
    <div className="sens">
      {rows.map(r => (
        <div key={r.key} className="sens-row">
          <span className="sens-label">{r.label}</span>
          <div className="sens-track">
            <div className="sens-bar" style={{ width: `${(r.swing / max) * 100}%` }} />
          </div>
          <span className="sens-val">±{fmtCurrency(r.swing / 2, { compact: true })}</span>
        </div>
      ))}
    </div>
  );
}
