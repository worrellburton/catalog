// imports
import { useEffect, useMemo, useState } from 'react';
import DirectoryPage from './DirectoryPage';
import DirectoryHero, { type HeroSlide } from './DirectoryHero';
import { loadBrands, type BrandRow } from '~/services/brands';
import { posterRendition } from '~/utils/poster-prefetch';

// types
interface BrandsDirectoryProps {
  onOpenBrand: (brand: string) => void;
  onClose: () => void;
}

// main logic
export default function BrandsDirectory({ onOpenBrand, onClose }: BrandsDirectoryProps) {
  const [rows, setRows] = useState<BrandRow[] | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadBrands().then(r => { if (!cancelled) setRows(r); });
    return () => { cancelled = true; };
  }, []);

  const slides = useMemo<HeroSlide[]>(() => (rows ?? []).slice(0, 6).map(b => ({
    key: b.name,
    title: b.name,
    description: `${b.productCount} ${b.productCount === 1 ? 'product' : 'products'} in the catalog`,
    image: b.sampleImageUrl,
    cta: `Shop ${b.name}`,
  })), [rows]);
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = rows ?? [];
    return q ? list.filter(b => b.name.toLowerCase().includes(q)) : list;
  }, [rows, filter]);

  return (
    <DirectoryPage
      eyebrow="Directory"
      title="Brands"
      meta={rows ? `${rows.length} ${rows.length === 1 ? 'brand' : 'brands'} in the catalog` : 'Loading…'}
      aside={
        <label className="dir-filter">
          <span className="dir-filter-label">Find a brand</span>
          <input
            type="search"
            className="dir-filter-input"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Type a name"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
      }
      hero={<DirectoryHero ghost="Brand" slides={slides} onOpen={s => onOpenBrand(s.key)} />}
      onClose={onClose}
    >
      {rows === null ? (
        <div className="dir-grid dir-grid--brands" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="dir-brand dir-skeleton" />)}
        </div>
      ) : visible.length === 0 ? (
        <p className="dir-empty">No brands match “{filter.trim()}”.</p>
      ) : (
        <div className="dir-grid dir-grid--brands">
          {visible.map(b => (
            <button key={b.name} type="button" className="dir-brand" onClick={() => onOpenBrand(b.name)}>
              <span className="dir-brand-image">
                {b.sampleImageUrl && <img src={posterRendition(b.sampleImageUrl) ?? b.sampleImageUrl} alt="" loading="lazy" />}
              </span>
              <span className="dir-name">{b.name}</span>
              <span className="dir-soft">{b.productCount} {b.productCount === 1 ? 'product' : 'products'}</span>
            </button>
          ))}
        </div>
      )}
    </DirectoryPage>
  );
}
