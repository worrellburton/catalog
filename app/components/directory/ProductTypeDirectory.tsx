// imports
import { useEffect, useState } from 'react';
import DirectoryPage from './DirectoryPage';
import GenderLens from './GenderLens';
import TypeIcon from './TypeIcon';
import {
  listProductsByType,
  resolveDirectoryType,
  type DirectoryGender,
  type DirectoryType,
  type DirectoryTypeProduct,
} from '~/services/directory';
import { posterRendition } from '~/utils/poster-prefetch';
import type { Product } from '~/data/looks';

// types
interface ProductTypeDirectoryProps {
  /** The /products/<slug> segment. */
  slug: string;
  gender: DirectoryGender;
  onChangeGender: (g: DirectoryGender) => void;
  onOpenProduct: (product: Product) => void;
  onBack: () => void;
  onClose: () => void;
}

// main logic
export default function ProductTypeDirectory({ slug, gender, onChangeGender, onOpenProduct, onBack, onClose }: ProductTypeDirectoryProps) {
  const [type, setType] = useState<DirectoryType | null | undefined>(undefined);
  const [products, setProducts] = useState<DirectoryTypeProduct[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setType(undefined);
    resolveDirectoryType(slug).then(t => { if (!cancelled) setType(t); });
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    if (!type) return;
    let cancelled = false;
    setProducts(null);
    listProductsByType(type.name, gender).then(p => { if (!cancelled) setProducts(p); });
    return () => { cancelled = true; };
  }, [type, gender]);

  const title = type ? type.name : (type === null ? 'Not found' : '…');
  const count = products?.length ?? 0;

  return (
    <DirectoryPage
      eyebrow={type ? `Products · ${type.department}` : 'Products'}
      title={title}
      meta={
        type === null
          ? 'There is no product type at this address.'
          : products ? `${count} ${count === 1 ? 'product' : 'products'}` : 'Loading…'
      }
      aside={type ? <GenderLens value={gender} onChange={onChangeGender} counts={type.counts} /> : undefined}
      back={{ label: 'All products', onClick: onBack }}
      onClose={onClose}
    >
      {type && (
        <div className="dir-type-hero" aria-hidden="true">
          <TypeIcon path={type.iconPath} size={56} />
        </div>
      )}
      {type && products === null ? (
        <div className="dir-grid dir-grid--products" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="dir-product dir-skeleton" />)}
        </div>
      ) : type && products && products.length === 0 ? (
        <p className="dir-empty">Nothing in {type.name} for this selection yet.</p>
      ) : type && products ? (
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
      ) : null}
    </DirectoryPage>
  );
}
