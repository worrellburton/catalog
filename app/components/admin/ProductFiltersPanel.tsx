// imports
import type { DateFilterMode, FacetCounts, HealthIssue, ProductBucket } from '~/utils/product-filters';

// types
export interface DateFilterControl {
  mode: DateFilterMode;
  refIso: string;
  refIsoEnd: string;
  setMode: (mode: DateFilterMode) => void;
  setRefIso: (iso: string) => void;
  setRefIsoEnd: (iso: string) => void;
}

interface ProductFiltersPanelProps {
  counts: FacetCounts;
  bucket: ProductBucket | null;
  issue: HealthIssue | null;
  date: DateFilterControl;
  onBucket: (bucket: ProductBucket | null) => void;
  onIssue: (issue: HealthIssue | null) => void;
}

// constants
export const ISSUE_LABEL: Record<HealthIssue, string> = {
  media: 'Media incomplete',
  identity: 'Name or brand missing',
  price: 'No price',
  link: 'Link not verified',
};

export const BUCKET_LABEL: Record<ProductBucket, string> = {
  'no-creative': 'Without creative',
  untagged: 'No gender tag',
  affiliate: 'Affiliate link',
  'no-affiliate': 'No affiliate link',
  automatic: 'Added automatically',
  seeded: 'From seeding',
  'soft-deleted': 'Soft deleted',
};

const BUCKET_HINT: Partial<Record<ProductBucket, string>> = {
  untagged: 'Leaks into every feed — the gender filter skips it',
  affiliate: 'Tracked affiliate URL, known retailer or brand program',
  automatic: 'Found and added by the Claude + Gemini pipeline',
  seeded: 'Fetched by the demand-driven seeding loop',
  'soft-deleted': 'Open to permanently delete',
};

const ISSUES: HealthIssue[] = ['media', 'price', 'link', 'identity'];
const SOURCE_BUCKETS: ProductBucket[] = ['no-creative', 'untagged', 'affiliate', 'no-affiliate', 'automatic', 'seeded'];
const QUICK_DATES: Array<[DateFilterMode, string]> = [['all', 'All time'], ['today', 'Today'], ['week', 'This week'], ['month', 'This month']];
const CUSTOM_DATES: Array<[DateFilterMode, string]> = [['before', 'Before'], ['on', 'On'], ['after', 'After'], ['between', 'Between']];

// main logic
/** The Filters popover: health issues, collections, date added and the
 *  soft-delete bin. Every option is single-select — click again to clear. */
export default function ProductFiltersPanel({ counts, bucket, issue, date, onBucket, onIssue }: ProductFiltersPanelProps) {
  const custom = date.mode === 'before' || date.mode === 'on' || date.mode === 'after' || date.mode === 'between';
  return (
    <div className="admin-pf-panel" role="menu">
      <section>
        <h4>Health issue</h4>
        {ISSUES.map(k => (
          <Option key={k} label={ISSUE_LABEL[k]} count={counts.issue[k]} active={issue === k} onClick={() => onIssue(issue === k ? null : k)} />
        ))}
      </section>
      <section>
        <h4>Collection</h4>
        {SOURCE_BUCKETS.map(k => (
          <Option key={k} label={BUCKET_LABEL[k]} hint={BUCKET_HINT[k]} count={counts.bucket[k]} active={bucket === k} onClick={() => onBucket(bucket === k ? null : k)} />
        ))}
      </section>
      <section>
        <h4>Date added</h4>
        <div className="admin-pf-dates">
          {QUICK_DATES.map(([mode, label]) => (
            <button key={mode} type="button" className={date.mode === mode ? 'is-active' : ''} onClick={() => { date.setMode(mode); date.setRefIso(''); date.setRefIsoEnd(''); }}>
              {label}
            </button>
          ))}
        </div>
        <div className="admin-pf-custom-date">
          <select value={custom ? date.mode : 'on'} onChange={e => { const m = e.target.value as DateFilterMode; date.setMode(m); if (m !== 'between') date.setRefIsoEnd(''); }}>
            {CUSTOM_DATES.map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}
          </select>
          <input type="date" value={date.refIso} onChange={e => { if (!custom) date.setMode('on'); date.setRefIso(e.target.value); }} />
        </div>
        {date.mode === 'between' && (
          <div className="admin-pf-custom-date">
            <span>and</span>
            <input type="date" value={date.refIsoEnd} onChange={e => date.setRefIsoEnd(e.target.value)} />
          </div>
        )}
      </section>
      <section className="admin-pf-danger">
        <Option label={BUCKET_LABEL['soft-deleted']} hint={BUCKET_HINT['soft-deleted']} count={counts.bucket['soft-deleted']} active={bucket === 'soft-deleted'} onClick={() => onBucket(bucket === 'soft-deleted' ? null : 'soft-deleted')} />
      </section>
    </div>
  );
}

// helpers
interface OptionProps { label: string; hint?: string; count: number; active: boolean; onClick: () => void }

function Option({ label, hint, count, active, onClick }: OptionProps) {
  return (
    <button type="button" role="menuitemradio" aria-checked={active} className={`admin-pf-option${active ? ' is-active' : ''}`} onClick={onClick} title={hint}>
      <span className="admin-pf-check" aria-hidden="true" />
      <span className="admin-pf-option-label">{label}</span>
      <span className="admin-pf-count">{count.toLocaleString()}</span>
    </button>
  );
}
