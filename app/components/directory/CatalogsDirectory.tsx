// imports
import { useEffect, useState } from 'react';
import DirectoryPage from './DirectoryPage';
import DirectoryHero, { type HeroSlide } from './DirectoryHero';
import { listDirectoryCatalogs, type DirectoryCatalog } from '~/services/directory';
import { posterRendition } from '~/utils/poster-prefetch';

// types
interface CatalogsDirectoryProps {
  onOpenCatalog: (name: string) => void;
  onClose: () => void;
}

// main logic
export default function CatalogsDirectory({ onOpenCatalog, onClose }: CatalogsDirectoryProps) {
  const [rows, setRows] = useState<DirectoryCatalog[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDirectoryCatalogs().then(r => { if (!cancelled) setRows(r); });
    return () => { cancelled = true; };
  }, []);

  const featured = (rows ?? []).filter(c => c.isFeatured);
  const rest = (rows ?? []).filter(c => !c.isFeatured);
  const slides: HeroSlide[] = (featured.length > 0 ? featured : rest).slice(0, 6).map(c => ({
    key: c.slug,
    title: c.name,
    description: c.description || `${c.productCount} ${c.productCount === 1 ? 'product' : 'products'}`,
    image: c.coverUrl || c.images[0] || null,
    cta: 'Open catalog',
  }));
  const openSlide = (s: HeroSlide) => { const c = (rows ?? []).find(x => x.slug === s.key); if (c) onOpenCatalog(c.name); };

  const renderRow = (c: DirectoryCatalog) => (
    <button key={c.slug} type="button" className="dir-catalog" onClick={() => onOpenCatalog(c.name)}>
      <span className="dir-catalog-strip" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, i) => {
          const src = c.images[i];
          return src
            ? <img key={i} src={posterRendition(src) ?? src} alt="" loading="lazy" />
            : <span key={i} className="dir-catalog-strip-empty" />;
        })}
      </span>
      <span className="dir-catalog-text">
        <span className="dir-name">{c.name}</span>
        {c.description && <span className="dir-catalog-desc">{c.description}</span>}
        <span className="dir-soft">{c.productCount} {c.productCount === 1 ? 'product' : 'products'}</span>
      </span>
      <svg className="dir-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
    </button>
  );

  return (
    <DirectoryPage
      eyebrow="Directory"
      title="Catalogs"
      meta={rows ? `${rows.length} curated ${rows.length === 1 ? 'catalog' : 'catalogs'}` : 'Loading…'}
      hero={<DirectoryHero ghost="Catalog" slides={slides} onOpen={openSlide} />}
      onClose={onClose}
    >
      {rows === null ? (
        <div className="dir-list" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="dir-catalog dir-skeleton" />)}
        </div>
      ) : (
        <>
          {featured.length > 0 && (
            <section className="dir-section">
              <h2 className="dir-section-title">Featured</h2>
              <div className="dir-list">{featured.map(renderRow)}</div>
            </section>
          )}
          {rest.length > 0 && (
            <section className="dir-section">
              <h2 className="dir-section-title">{featured.length > 0 ? 'More catalogs' : 'Catalogs'}</h2>
              <div className="dir-list">{rest.map(renderRow)}</div>
            </section>
          )}
          {rows.length === 0 && <p className="dir-empty">No catalogs are live yet.</p>}
        </>
      )}
    </DirectoryPage>
  );
}
