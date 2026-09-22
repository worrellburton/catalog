// imports
import { useEffect, useState } from 'react';
import { listCrawlJobProducts, type CrawlJob, type CrawlJobProduct } from '~/services/site-crawls';

// types
interface CrawlProductsRowProps {
  job: Pick<CrawlJob, 'id' | 'site_name'>;
  /** Number of columns in the parent table, so the panel spans the row. */
  colSpan: number;
}

// main logic
/**
 * Expandable table row under a crawl job listing every product the job
 * ingested (image, brand, name, price, link). Fetches on mount so a
 * collapsed row costs nothing; the parent decides when to render it.
 */
export default function CrawlProductsRow({ job, colSpan }: CrawlProductsRowProps) {
  const [products, setProducts] = useState<CrawlJobProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listCrawlJobProducts(job)
      .then(rows => { if (!cancelled) setProducts(rows); })
      .catch((e: Error) => { if (!cancelled) setError(e.message || 'Failed to load products'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [job.id, job.site_name]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <tr className="admin-look-expanded-row open">
      <td colSpan={colSpan} style={{ padding: 0 }}>
        <div className="admin-expand-animate">
          <div className="admin-look-products">
            <h3 className="admin-products-title">
              {loading ? 'Products' : `${products.length} ${products.length === 1 ? 'product' : 'products'} ingested`}
            </h3>
            {loading ? (
              <div className="admin-empty" style={{ padding: '16px 0' }}>Loading products…</div>
            ) : error ? (
              <div className="admin-empty" style={{ padding: '16px 0', color: '#ef4444' }}>{error}</div>
            ) : products.length === 0 ? (
              <div className="admin-empty" style={{ padding: '16px 0' }}>
                No products are attributed to this crawl yet.
              </div>
            ) : (
              <div className="admin-products-grid" style={{ padding: 0 }}>
                {products.map(p => (
                  <a
                    key={p.id}
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
