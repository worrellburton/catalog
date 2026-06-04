import type { ChipGroup } from '~/utils/productTaxonomy';

interface ProductSuggestionChipsProps {
  groups: ChipGroup[];
}

/**
 * Informational chip section that sits directly below the Size & fit spec
 * sheet on ProductPage. Surfaces the styling/fit metadata we already collect
 * (occasion, body-type match, season, works-with) as scannable chips so the
 * product reads as useful rather than a bare image + price. Renders nothing
 * when there's no metadata to show.
 */
export default function ProductSuggestionChips({ groups }: ProductSuggestionChipsProps) {
  if (!groups || groups.length === 0) return null;

  return (
    <section className="pd-chips" aria-label="What this is good for">
      <h2 className="pd-chips-title">Best for</h2>
      <div className="pd-chip-groups">
        {groups.map(group => (
          <div key={group.key} className={`pd-chip-group pd-chip-group--${group.tone}`}>
            <span className="pd-chip-group-label">{group.label}</span>
            <div className="pd-chip-row">
              {group.items.map(item => (
                <span key={item} className="pd-chip">{item}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
