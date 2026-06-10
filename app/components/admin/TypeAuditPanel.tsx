// Type-audit report for the type brain (/admin/governance/types → "Type
// audit"). Shows every product the audit thinks belongs in a better node —
// current type → recommended path, with the reason — and lets the admin
// apply all (or a hand-picked subset) in one undoable gesture.

import { useState } from 'react';
import type { TypeAuditRecommendation } from '~/services/type-governance';

interface Props {
  recommendations: TypeAuditRecommendation[];
  /** Applies the checked subset as one products-update gesture. */
  onApply: (recs: TypeAuditRecommendation[]) => void;
  onClose: () => void;
}

export default function TypeAuditPanel({ recommendations, onApply, onClose }: Props) {
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(recommendations.map(r => r.productId)),
  );
  const toggle = (id: string) => setChecked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allChecked = checked.size === recommendations.length;
  const picked = recommendations.filter(r => checked.has(r.productId));

  return (
    <div className="gov-audit">
      <div className="gov-audit-head">
        <div>
          <h2>Type audit</h2>
          <span>
            {recommendations.length === 0
              ? 'Every product already sits in its best type.'
              : `${recommendations.length} product${recommendations.length === 1 ? '' : 's'} could live in a better type.`}
          </span>
        </div>
        <button type="button" className="gov-ghost" onClick={onClose}>✕ Close</button>
      </div>

      {recommendations.length > 0 && (
        <>
          <div className="gov-audit-toolbar">
            <button
              type="button"
              className="gov-ghost"
              onClick={() => setChecked(allChecked ? new Set() : new Set(recommendations.map(r => r.productId)))}
            >
              {allChecked ? 'Uncheck all' : 'Check all'}
            </button>
            <span>{checked.size} of {recommendations.length} selected</span>
          </div>
          <div className="gov-audit-list">
            {recommendations.map(r => (
              <label key={r.productId} className={`gov-audit-row${checked.has(r.productId) ? ' is-checked' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked.has(r.productId)}
                  onChange={() => toggle(r.productId)}
                />
                <span className="gov-audit-thumb">
                  {r.image ? <img src={r.image} alt="" loading="lazy" decoding="async" /> : <i>{r.name.slice(0, 2)}</i>}
                </span>
                <span className="gov-audit-prod">
                  {r.brand && <em>{r.brand}</em>}
                  <strong>{r.name}</strong>
                  <small>{r.reason}</small>
                </span>
                <span className="gov-audit-change">
                  <s>{r.fromType ?? 'unassigned'}</s>
                  <i aria-hidden="true">→</i>
                  <b>{r.toPath}</b>
                </span>
              </label>
            ))}
          </div>
          <div className="gov-audit-foot">
            <button type="button" className="gov-ghost" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="gov-audit-apply"
              disabled={picked.length === 0}
              onClick={() => onApply(picked)}
            >
              Apply {picked.length} change{picked.length === 1 ? '' : 's'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
