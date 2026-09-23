// imports
import { useEffect, useState } from 'react';

// types
/** The fields the grid renders. Both CrawlJobProduct and the consumer
 *  Product type satisfy it, so callers pass their rows straight through. */
export interface ExpandProduct {
  id?: string;
  name: string;
  brand: string;
  price: string;
  url: string;
  image?: string | null;
}

interface ProductsExpandRowProps {
  /** Fetches the products to list. Re-run whenever `loadKey` changes. */
  load: () => Promise<ExpandProduct[]>;
  loadKey: string;
  /** Number of columns in the parent table, so the panel spans the row. */
  colSpan: number;
  /** Completes the heading "N products <verb>", e.g. "ingested". */
  verb: string;
  emptyText: string;
}

// main logic
/**
 * Expandable table row listing products (image, brand, name, price, link)
 * under a parent row — a crawl job's ingested products, or a creator's
 * linked ones. Fetches on mount so a collapsed row costs nothing; the
 * parent decides when to render it.
 */
export default function ProductsExpandRow({ load, loadKey, colSpan, verb, emptyText }: ProductsExpandRowProps) {
  const [products, setProducts] = useState<ExpandProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    load()
      .then(rows => { if (!cancelled) setProducts(rows); })
      .catch((e: Error) => { if (!cancelled) setError(e.message || 'Failed to load products'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <tr className="admin-look-expanded-row open">
      <td colSpan={colSpan} style={{ padding: 0 }}>
        <div className="admin-expand-animate">
          <div className="admin-look-products">
            <h3 className="admin-products-title">
              {loading ? 'Products' : `${products.length} ${products.length === 1 ? 'product' : 'products'} ${verb}`}
            </h3>
            {loading ? (
              <div className="admin-empty" style={{ padding: '16px 0' }}>Loading products…</div>
            ) : error ? (
              <div className="admin-empty" style={{ padding: '16px 0', color: '#ef4444' }}>{error}</div>
            ) : products.length === 0 ? (
              <div className="admin-empty" style={{ padding: '16px 0' }}>{emptyText}</div>
            ) : (
              <div className="admin-products-grid" style={{ padding: 0 }}>
                {products.map((p, i) => (
                  <a
                    key={p.id ?? `${p.brand}::${p.name}::${i}`}
                    className="admin-product-card"
                    href={p.url || undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ textDecoration: 'none', color: 'inherit' }}
                    title={p.name}
                  >
                    {p.image ? (
                      <img className="admin-product-img" src={p.image} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <div className="admin-product-img admin-product-thumb--empty" aria-hidden="true" />
                    )}
                    <div className="admin-product-info">
                      {p.brand && <span className="admin-product-brand">{p.brand}</span>}
                      <span className="admin-product-name">{p.name}</span>
                      {p.price && <span className="admin-product-price">{p.price}</span>}
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}
