// imports
import type { Product } from '~/data/looks';
import type { DirectoryTypeProduct } from '~/services/directory';
import { posterRendition } from '~/utils/poster-prefetch';

// types
interface ProductGridProps {
  /** null while loading (skeleton tiles). */
  products: DirectoryTypeProduct[] | null;
  onOpenProduct: (product: Product) => void;
  emptyText: string;
}

// main logic
/** The Paper Catalog product grid shared by /products and /products/<type>. */
export default function ProductGrid({ products, onOpenProduct, emptyText }: ProductGridProps) {
  if (products === null) {
    return (
      <div className="dir-grid dir-grid--products" aria-hidden="true">
        {Array.from({ length: 10 }).map((_, i) => <div key={i} className="dir-product dir-skeleton" />)}
      </div>
    );
  }
  if (products.length === 0) return <p className="dir-empty">{emptyText}</p>;
  return (
    <div className="dir-grid dir-grid--products">
      {products.map(p => (
        <button key={p.id} type="button" className="dir-product" onClick={() => onOpenProduct(p)}>
          <span className="dir-product-image">
            {p.image && <img src={posterRendition(p.image) ?? p.image} alt="" loading="lazy" />}
          </span>
          {p.brand && <span className="dir-eyebrow dir-eyebrow--small">{p.brand}</span>}
          <span className="dir-name dir-name--product">{p.name}</span>
          {p.price && <span className="dir-soft dir-price">{p.price}</span>}
        </button>
      ))}
    </div>
  );
}
