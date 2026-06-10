import type { ChipGroup } from '~/utils/productTaxonomy';

interface ProductSuggestionChipsProps {
  groups: ChipGroup[];
  /** Tap a chip → runs the chip's text as a search (same path as the
   *  "Popular in" pills). When omitted the chips render as inert labels. */
  onSearch?: (query: string) => void;
}

/**
 * Informational chip section that sits directly below the Size & fit spec
 * sheet on ProductPage. Surfaces the styling/fit metadata we already collect
 * (occasion, body-type match, season, works-with) as scannable chips so the
 * product reads as useful rather than a bare image + price. Renders nothing
 * when there's no metadata to show.
 *
 * When `onSearch` is supplied each chip becomes a tappable discovery hook —
 * clicking it runs the chip label as a feed search.
 */
export default function ProductSuggestionChips({ groups, onSearch }: ProductSuggestionChipsProps) {
  if (!groups || groups.length === 0) return null;

  return (
    <section className="pd-chips" aria-label="What this is good for">
      <h2 className="pd-chips-title">Best for</h2>
      <div className="pd-chip-groups">
        {groups.map(group => (
          <div key={group.key} className={`pd-chip-group pd-chip-group--${group.tone}`}>
            <span className="pd-chip-group-label">{group.label}</span>
            <div className="pd-chip-row">
              {group.items.map(item =>
                onSearch ? (
                  <button
                    key={item}
                    type="button"
                    className="pd-chip pd-chip--tappable"
                    onClick={() => onSearch(item)}
                  >
                    {item}
                  </button>
                ) : (
                  <span key={item} className="pd-chip">{item}</span>
                )
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
