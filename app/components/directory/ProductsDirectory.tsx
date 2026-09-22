// imports
import { useEffect, useMemo, useState } from 'react';
import DirectoryPage from './DirectoryPage';
import DirectoryHero, { type HeroSlide } from './DirectoryHero';
import GenderLens from './GenderLens';
import ProductGrid from './ProductGrid';
import TypeIcon from './TypeIcon';
import {
  listDirectoryTypes,
  listProducts,
  type DirectoryGender,
  type DirectoryType,
  type DirectoryTypeProduct,
} from '~/services/directory';
import type { Product } from '~/data/looks';

// types
interface ProductsDirectoryProps {
  gender: DirectoryGender;
  onChangeGender: (g: DirectoryGender) => void;
  onOpenType: (type: DirectoryType) => void;
  onOpenProduct: (product: Product) => void;
  onClose: () => void;
}

// main logic
/**
 * /products — every product in the catalog under the gender lens, with a
 * row of type chips to narrow into /products/<type>. The hover mega menu is
 * the directory; this is the whole shelf.
 */
export default function ProductsDirectory({ gender, onChangeGender, onOpenType, onOpenProduct, onClose }: ProductsDirectoryProps) {
  const [types, setTypes] = useState<DirectoryType[] | null>(null);
  const [products, setProducts] = useState<DirectoryTypeProduct[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDirectoryTypes().then(t => { if (!cancelled) setTypes(t); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setProducts(null);
    listProducts(gender).then(p => { if (!cancelled) setProducts(p); });
    return () => { cancelled = true; };
  }, [gender]);

  const chips = useMemo(
    () => (types ?? []).filter(t => t.counts[gender] > 0).sort((a, b) => b.counts[gender] - a.counts[gender]),
    [types, gender],
  );
  const lensCounts = useMemo(() => types ? {
    all: types.reduce((n, t) => n + t.counts.all, 0),
    women: types.reduce((n, t) => n + t.counts.women, 0),
    men: types.reduce((n, t) => n + t.counts.men, 0),
  } : undefined, [types]);
  const count = products?.length ?? 0;
  const slides = useMemo<HeroSlide[]>(() => chips.slice(0, 6).map(t => ({
    key: t.id,
    title: t.name,
    description: `${t.counts[gender]} ${t.counts[gender] === 1 ? 'product' : 'products'} in ${t.department}`,
    image: t.heroImage,
    cta: `Shop ${t.name}`,
  })), [chips, gender]);
  const openSlide = (s: HeroSlide) => { const t = chips.find(x => x.id === s.key); if (t) onOpenType(t); };

  return (
    <DirectoryPage
      eyebrow="Directory"
      title="Products"
      meta={products ? `${count} ${count === 1 ? 'product' : 'products'}` : 'Loading…'}
      aside={<GenderLens value={gender} onChange={onChangeGender} counts={lensCounts} />}
      hero={<DirectoryHero ghost="Type" slides={slides} onOpen={openSlide} />}
      onClose={onClose}
    >
      {chips.length > 0 && (
        <div className="dir-type-chips" aria-label="Shop by type">
          {chips.map(t => (
            <button key={t.id} type="button" className="dir-type-chip" onClick={() => onOpenType(t)}>
              <TypeIcon path={t.iconPath} size={16} />
              <span className="dir-type-chip-name">{t.name}</span>
              <span className="dir-type-chip-count">{t.counts[gender]}</span>
            </button>
          ))}
        </div>
      )}
      <ProductGrid products={products} onOpenProduct={onOpenProduct} emptyText="Nothing here for this selection yet." />
    </DirectoryPage>
  );
}
