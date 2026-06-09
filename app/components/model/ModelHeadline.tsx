import { useEffect, useRef, useState, type ReactElement } from 'react';
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
  onBusinessPlan,
  onRate,
}: {
  scenario: ScenarioId;
  onScenario: (id: ScenarioId) => void;
  onExportCsv: () => void;
  onPrint: () => void;
  onBusinessPlan: () => void;
  onRate: () => void;
}) {
  // Download dropdown: CSV / PDF / Business plan.
  const [downloadOpen, setDownloadOpen] = useState(false);
  const downloadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!downloadOpen) return;
    const handler = (e: MouseEvent) => {
      if (downloadRef.current && !downloadRef.current.contains(e.target as Node)) setDownloadOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [downloadOpen]);

  const pick = (fn: () => void) => { setDownloadOpen(false); fn(); };

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
          <button className="model-rate-btn model-rate-btn--icon" onClick={onRate} aria-label="Rate my assumptions" title="Rate my assumptions">
            <svg width="16" height="16" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">
              <path d="M50 4 C54 30 70 46 96 50 C70 54 54 70 50 96 C46 70 30 54 4 50 C30 46 46 30 50 4 Z" />
            </svg>
          </button>
          <div ref={downloadRef} className="model-download" style={{ position: 'relative' }}>
            <button
              className="admin-btn admin-btn-secondary"
              onClick={() => setDownloadOpen(o => !o)}
              aria-haspopup="menu"
              aria-expanded={downloadOpen}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {downloadOpen && (
              <div
                role="menu"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  right: 0,
                  minWidth: 200,
                  background: '#1c1c20',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 10,
                  boxShadow: '0 18px 50px rgba(0,0,0,0.5)',
                  padding: 4,
                  zIndex: 60,
                }}
              >
                {[
                  { label: 'CSV', sub: 'Raw model data', onClick: onExportCsv },
                  { label: 'PDF', sub: 'Print the model', onClick: onPrint },
                  { label: 'Business plan', sub: 'Full Catalog-branded plan', onClick: onBusinessPlan },
                ].map(item => (
                  <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    onClick={() => pick(item.onClick)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '8px 10px', borderRadius: 6, border: 'none',
                      background: 'transparent', color: '#f4f4f5', cursor: 'pointer',
                      font: 'inherit',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{item.label}</span>
                    <span style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{item.sub}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
