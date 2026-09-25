// imports
import { useEffect, useRef, useState } from 'react';
import ProductFiltersPanel, { BUCKET_LABEL, ISSUE_LABEL, type DateFilterControl } from '~/components/admin/ProductFiltersPanel';
import type { FacetCounts, GenderFilter, HealthFilter, ProductFilterState, ProductStatus } from '~/utils/product-filters';

// types
export interface ContextChip {
  key: string;
  label: string;
  onClear: () => void;
}

interface ProductFilterBarProps {
  state: ProductFilterState;
  counts: FacetCounts;
  shown: number;
  onChange: (patch: Partial<ProductFilterState>) => void;
  onClearAll: () => void;
  date: DateFilterControl;
  dateLabel: string;
  /** Filters set from outside the bar (brand deep-link, seeding target). */
  contextChips: ContextChip[];
}

interface SegOption<T extends string> { value: T; label: string; count?: number; tone?: 'ok' | 'warn' | 'fail' }

// constants
const STATUS_LABEL: Record<ProductStatus, string> = { all: 'All', active: 'Live', inactive: 'Hidden' };
const HEALTH_LABEL: Record<HealthFilter, string> = { all: 'Any', ok: 'Healthy', warn: 'Check', fail: 'Fix' };
const GENDER_LABEL: Record<GenderFilter, string> = { all: 'Everyone', female: 'Women', male: 'Men', unisex: 'Unisex' };

// main logic
/** Data → Products control bar: Status · Health · Audience segments with live
 *  counts, a Filters popover for everything else, and a summary line with a
 *  removable chip per active filter. */
export default function ProductFilterBar({ state, counts, shown, onChange, onClearAll, date, dateLabel, contextChips }: ProductFilterBarProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!panelOpen) return;
    const onDown = (e: MouseEvent) => { if (!panelRef.current?.contains(e.target as Node)) setPanelOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanelOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [panelOpen]);

  const softDeleted = state.bucket === 'soft-deleted';
  const chips: ContextChip[] = [
    ...(state.status !== 'active' && !softDeleted ? [{ key: 'status', label: state.status === 'all' ? 'Live + hidden' : 'Hidden only', onClear: () => onChange({ status: 'active' }) }] : []),
    ...(state.health !== 'all' ? [{ key: 'health', label: HEALTH_LABEL[state.health], onClear: () => onChange({ health: 'all' }) }] : []),
    ...(state.gender !== 'all' ? [{ key: 'gender', label: GENDER_LABEL[state.gender], onClear: () => onChange({ gender: 'all' }) }] : []),
    ...(state.issue ? [{ key: 'issue', label: ISSUE_LABEL[state.issue], onClear: () => onChange({ issue: null }) }] : []),
    ...(state.bucket ? [{ key: 'bucket', label: BUCKET_LABEL[state.bucket], onClear: () => onChange({ bucket: null }) }] : []),
    ...(date.mode !== 'all' ? [{ key: 'date', label: dateLabel, onClear: () => { date.setMode('all'); date.setRefIso(''); date.setRefIsoEnd(''); } }] : []),
    ...contextChips,
  ];
  const panelCount = (state.issue ? 1 : 0) + (state.bucket ? 1 : 0) + (date.mode !== 'all' ? 1 : 0);

  return (
    <div className={`admin-pf${softDeleted ? ' is-bin' : ''}`}>
      <div className="admin-pf-row">
        <Segment
          label="Status"
          value={state.status}
          disabled={softDeleted}
          onSelect={status => onChange({ status })}
          options={(['active', 'inactive', 'all'] as ProductStatus[]).map(v => ({ value: v, label: STATUS_LABEL[v], count: counts.status[v] }))}
        />
        <Segment
          label="Health"
          value={state.health}
          onSelect={health => onChange({ health })}
          options={(['all', 'ok', 'warn', 'fail'] as HealthFilter[]).map(v => ({ value: v, label: HEALTH_LABEL[v], count: counts.health[v], tone: v === 'all' ? undefined : v }))}
        />
        <Segment
          label="Audience"
          value={state.gender}
          onSelect={gender => onChange({ gender })}
          options={(['all', 'female', 'male', 'unisex'] as GenderFilter[]).map(v => ({ value: v, label: GENDER_LABEL[v], count: v === 'all' ? undefined : counts.gender[v] }))}
        />
        <div className="admin-pf-more" ref={panelRef}>
          <button type="button" className={`admin-pf-more-btn${panelCount ? ' is-engaged' : ''}`} onClick={() => setPanelOpen(v => !v)} aria-haspopup="menu" aria-expanded={panelOpen}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="4" y1="7" x2="20" y2="7" /><line x1="7" y1="12" x2="17" y2="12" /><line x1="10" y1="17" x2="14" y2="17" />
            </svg>
            Filters
            {panelCount > 0 && <span className="admin-pf-more-badge">{panelCount}</span>}
          </button>
          {panelOpen && (
            <ProductFiltersPanel
              counts={counts}
              bucket={state.bucket}
              issue={state.issue}
              date={date}
              onBucket={bucket => onChange({ bucket })}
              onIssue={issue => onChange({ issue })}
            />
          )}
        </div>
      </div>
      <div className="admin-pf-summary" aria-live="polite">
        <span className="admin-pf-total"><strong>{shown.toLocaleString()}</strong> {shown === 1 ? 'product' : 'products'}</span>
        {chips.map(c => (
          <span key={c.key} className="admin-pf-chip">
            {c.label}
            <button type="button" onClick={c.onClear} aria-label={`Remove ${c.label}`}>×</button>
          </span>
        ))}
        {chips.length > 1 && <button type="button" className="admin-pf-clear" onClick={onClearAll}>Clear all</button>}
      </div>
    </div>
  );
}

// helpers
interface SegmentProps<T extends string> {
  label: string;
  value: T;
  options: Array<SegOption<T>>;
  disabled?: boolean;
  onSelect: (value: T) => void;
}

function Segment<T extends string>({ label, value, options, disabled, onSelect }: SegmentProps<T>) {
  return (
    <div className={`admin-pf-seg${disabled ? ' is-disabled' : ''}`} role="radiogroup" aria-label={label}>
      <span className="admin-pf-seg-label">{label}</span>
      <div className="admin-pf-seg-track">
        {options.map(o => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            disabled={disabled}
            className={`admin-pf-seg-opt${value === o.value ? ' is-active' : ''}`}
            onClick={() => onSelect(o.value)}
          >
            {o.tone && <span className={`admin-pf-dot is-${o.tone}`} aria-hidden="true" />}
            {o.label}
            {o.count != null && <span className="admin-pf-count">{o.count.toLocaleString()}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
