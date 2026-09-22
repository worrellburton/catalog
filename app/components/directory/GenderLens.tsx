// imports
import type { DirectoryGender } from '~/services/directory';

// types
interface GenderLensProps {
  value: DirectoryGender;
  onChange: (g: DirectoryGender) => void;
  /** Optional counts shown beside each option. */
  counts?: Partial<Record<DirectoryGender, number>>;
}

// constants
const OPTIONS: Array<{ key: DirectoryGender; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'women', label: 'Women' },
  { key: 'men', label: 'Men' },
];

// main logic
/** Paper Catalog segmented control: eyebrow options on one hairline. */
export default function GenderLens({ value, onChange, counts }: GenderLensProps) {
  return (
    <div className="dir-lens" role="tablist" aria-label="Shop for">
      {OPTIONS.map(o => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={value === o.key}
          className={`dir-lens-btn${value === o.key ? ' is-active' : ''}`}
          onClick={() => onChange(o.key)}
        >
          {o.label}
          {counts && counts[o.key] != null && <span className="dir-lens-count">{counts[o.key]}</span>}
        </button>
      ))}
    </div>
  );
}
