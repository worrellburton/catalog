// imports
import type { ReactNode } from 'react';
import type { AdminProduct } from '~/services/admin-product';
import { formatRelative } from '~/utils/format-relative';
import { LINK_STATE_LABEL, type ProductHealth } from '~/utils/product-health';

// types
interface ProductPageFactsProps {
  product: AdminProduct;
  health: ProductHealth;
}

// constants
const GENDER_LABEL: Record<string, string> = { male: 'Men', female: 'Women', unisex: 'Unisex' };

// helpers
function when(iso: string | null): ReactNode {
  if (!iso) return null;
  return <span title={new Date(iso).toLocaleString()}>{new Date(iso).toLocaleDateString()} · {formatRelative(iso)}</span>;
}

function linkOut(url: string | null): ReactNode {
  if (!url) return null;
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keep raw */ }
  return <a href={url} target="_blank" rel="noopener noreferrer">{host} ↗</a>;
}

// main logic
/** Health checks, then every stored fact about the product as spec rows. */
export default function ProductPageFacts({ product, health }: ProductPageFactsProps) {
  const specs: Array<[string, ReactNode]> = [
    ['Type', [product.type, product.subtype].filter(Boolean).join(' · ') || null],
    ['Audience', product.gender ? GENDER_LABEL[product.gender] ?? product.gender : null],
    ['Retailer', linkOut(product.url)],
    ['Link', `${LINK_STATE_LABEL[health.link]}${product.url_status != null ? ` (${product.url_status})` : ''}`],
    ['Link checked', when(product.url_checked_at)],
    ['Affiliate', product.affiliate_url ? <>{linkOut(product.affiliate_url)}{product.affiliate_source ? ` · ${product.affiliate_source}` : ''}</> : null],
    ['Source', product.source],
    ['Added', when(product.created_at)],
    ['Scraped', product.scraped_at ? <>{when(product.scraped_at)}{product.scrape_status ? ` · ${product.scrape_status}` : ''}</> : product.scrape_status],
    ['Barcode', product.barcode ? `${product.barcode}${product.barcode_type ? ` (${product.barcode_type})` : ''}` : null],
    ['Size & fit', product.size_fit],
    ['Materials', product.materials_care],
    ['Style read', product.haiku_context],
    ['Description', product.description],
  ];

  return (
    <>
      <section className="admin-pp-section">
        <h2>Health</h2>
        <ul className="admin-pp-checks">
          {health.checks.map(c => (
            <li key={c.key} className={`is-${c.level}`}>
              <i aria-hidden="true" />
              <span className="admin-pp-check-label">{c.label}</span>
              <span className="admin-pp-check-detail">{c.detail}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="admin-pp-section">
        <h2>Details</h2>
        <dl className="admin-pp-specs">
          {specs.map(([label, value]) => (
            <div key={label} className={value ? '' : 'is-empty'}>
              <dt>{label}</dt>
              <dd>{value || '—'}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
