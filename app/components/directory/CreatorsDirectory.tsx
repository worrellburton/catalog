// imports
import { useEffect, useState, type ReactNode } from 'react';
import DirectoryPage from './DirectoryPage';
import { listDirectoryCreators, type DirectoryCreator } from '~/services/directory';
import { posterRendition } from '~/utils/poster-prefetch';

// types
interface CreatorsDirectoryProps {
  onOpenCreator: (handle: string) => void;
  onClose: () => void;
  /** The following / followers rail, rendered as the first section. */
  rail?: ReactNode;
}

// constants
/** When nobody has been featured yet, the top of the ranking stands in so
 *  the page never opens on an empty shelf. */
const FALLBACK_FEATURED = 6;

// helpers
function countLine(c: DirectoryCreator): string {
  const parts: string[] = [];
  parts.push(`${c.looks} ${c.looks === 1 ? 'look' : 'looks'}`);
  if (c.followers > 0) parts.push(`${c.followers} ${c.followers === 1 ? 'follower' : 'followers'}`);
  return parts.join(' · ');
}

function Avatar({ c, size }: { c: DirectoryCreator; size: number }) {
  return c.avatarUrl
    ? <img className="dir-avatar" src={c.avatarUrl} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" style={{ width: size, height: size }} />
    : <span className="dir-avatar dir-avatar--initial" style={{ width: size, height: size, fontSize: size * 0.42 }}>{c.displayName.charAt(0).toUpperCase()}</span>;
}

// main logic
export default function CreatorsDirectory({ onOpenCreator, onClose, rail }: CreatorsDirectoryProps) {
  const [rows, setRows] = useState<DirectoryCreator[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDirectoryCreators().then(r => { if (!cancelled) setRows(r); });
    return () => { cancelled = true; };
  }, []);

  const curated = (rows ?? []).filter(c => c.featured);
  const featured = curated.length > 0 ? curated : (rows ?? []).slice(0, FALLBACK_FEATURED);
  const featuredSet = new Set(featured.map(c => c.handle));
  const everyone = (rows ?? []).filter(c => !featuredSet.has(c.handle));

  return (
    <DirectoryPage
      eyebrow="Directory"
      title="Creators"
      meta={rows ? `${rows.length} ${rows.length === 1 ? 'creator' : 'creators'} curating on Catalog` : 'Loading…'}
      onClose={onClose}
    >
      {rail && (
        <section className="dir-section">
          <h2 className="dir-section-title">Following</h2>
          <div className="dir-rail">{rail}</div>
        </section>
      )}

      <section className="dir-section">
        <h2 className="dir-section-title">Featured</h2>
        {rows === null ? (
          <div className="dir-grid dir-grid--featured" aria-hidden="true">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="dir-featured dir-skeleton" />)}
          </div>
        ) : (
          <div className="dir-grid dir-grid--featured">
            {featured.map(c => (
              <button key={c.handle} type="button" className="dir-featured" onClick={() => onOpenCreator(c.handle)}>
                <span className="dir-featured-posters">
                  {Array.from({ length: 3 }).map((_, i) => {
                    const src = c.posters[i];
                    return src
                      ? <img key={i} src={posterRendition(src) ?? src} alt="" loading="lazy" />
                      : <span key={i} className="dir-featured-poster-empty" />;
                  })}
                </span>
                <span className="dir-featured-row">
                  <Avatar c={c} size={44} />
                  <span className="dir-featured-text">
                    <span className="dir-name">{c.displayName}</span>
                    <span className="dir-soft">{countLine(c)}</span>
                  </span>
                  <svg className="dir-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {everyone.length > 0 && (
        <section className="dir-section">
          <h2 className="dir-section-title">All creators</h2>
          <div className="dir-list">
            {everyone.map(c => (
              <button key={c.handle} type="button" className="dir-row" onClick={() => onOpenCreator(c.handle)}>
                <Avatar c={c} size={40} />
                <span className="dir-row-text">
                  <span className="dir-name dir-name--row">{c.displayName}</span>
                  <span className="dir-soft">{countLine(c)}</span>
                </span>
                <svg className="dir-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            ))}
          </div>
        </section>
      )}
    </DirectoryPage>
  );
}
