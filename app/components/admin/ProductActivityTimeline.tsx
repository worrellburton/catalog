// imports
import { formatRelative } from '~/utils/format-relative';
import type { ActivityItem, ActivityKind, ActivityTotals } from '~/services/product-activity';

// types
interface ProductActivityTimelineProps {
  items: ActivityItem[];
  /** Cap the list (dropdown); the product page shows everything. */
  limit?: number;
}

interface ActivityTotalsRowProps {
  totals: ActivityTotals;
}

// constants
const KIND_LABEL: Record<ActivityKind, string> = {
  impressions: 'Seen',
  clickout: 'Clickout',
  affiliate: 'Affiliate',
  search: 'Search',
  look: 'Look',
  catalog: 'Catalog',
  creator: 'Creator',
  creative: 'Video',
  pipeline: 'Pipeline',
  created: 'Added',
};

const TOTALS: Array<[keyof ActivityTotals, string]> = [
  ['impressions', 'Impressions'],
  ['clickouts', 'Clickouts'],
  ['affiliateClicks', 'Affiliate'],
  ['searchClicks', 'Search'],
  ['looks', 'Looks'],
  ['catalogs', 'Catalogs'],
  ['creators', 'Creators'],
  ['creatives', 'Videos'],
];

// main logic
/** Headline numbers for a product's activity. */
export function ActivityTotalsRow({ totals }: ActivityTotalsRowProps) {
  return (
    <div className="admin-activity-totals">
      {TOTALS.map(([key, label]) => (
        <span key={key} className={totals[key] ? '' : 'is-zero'}>
          <strong>{totals[key].toLocaleString()}</strong>
          {label}
        </span>
      ))}
    </div>
  );
}

/** Newest-first list of everything that happened to a product. */
export default function ProductActivityTimeline({ items, limit }: ProductActivityTimelineProps) {
  const shown = limit ? items.slice(0, limit) : items;
  if (shown.length === 0) return <p className="admin-activity-empty">No activity yet.</p>;
  return (
    <ol className="admin-activity-list">
      {shown.map(item => (
        <li key={item.id} className={`is-${item.kind}`}>
          <span className="admin-activity-kind">{KIND_LABEL[item.kind]}</span>
          <span className="admin-activity-body">
            <span className="admin-activity-label">{item.label}</span>
            {(item.detail || item.who) && (
              <span className="admin-activity-detail">{[item.who, item.detail].filter(Boolean).join(' · ')}</span>
            )}
          </span>
          <time dateTime={item.at} title={new Date(item.at).toLocaleString()}>{formatRelative(item.at)}</time>
        </li>
      ))}
    </ol>
  );
}
