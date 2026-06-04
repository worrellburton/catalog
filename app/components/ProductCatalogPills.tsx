import type { ProductCatalog } from '~/services/catalogs';

interface ProductCatalogPillsProps {
  catalogs: ProductCatalog[];
  /** Opens the tapped catalog's feed (runs the catalog name as a search). */
  onOpenCatalog: (name: string) => void;
}

/**
 * "Popular in" — the curated catalogs a product belongs to, rendered as
 * tappable pills on the product page info column (beside the "Best for"
 * chips). Tapping opens that catalog's feed via the standard search path,
 * so it doubles as a discovery hook. Renders nothing when the product
 * matches no catalog.
 */
export default function ProductCatalogPills({ catalogs, onOpenCatalog }: ProductCatalogPillsProps) {
  if (!catalogs || catalogs.length === 0) return null;

  return (
    <section className="pd-popular" aria-label="Popular in catalogs">
      <h2 className="pd-popular-title">Popular in</h2>
      <div className="pd-popular-row">
        {catalogs.map(c => (
          <button
            key={c.slug}
            type="button"
            className="pd-popular-pill"
            onClick={() => onOpenCatalog(c.name)}
          >
            {c.name}
          </button>
        ))}
      </div>
    </section>
  );
}
