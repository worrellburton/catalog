// imports
import { useEffect, type ReactNode } from 'react';
import { useEscapeKey } from '~/hooks/useEscapeKey';
import '~/styles/directory.css';

// types
interface DirectoryPageProps {
  /** Tracked eyebrow above the title ("DIRECTORY", "PRODUCTS · FASHION"). */
  eyebrow: string;
  title: string;
  /** Soft line under the title — a count or a one-sentence description. */
  meta?: ReactNode;
  /** Right-aligned control beside the title (the gender lens). */
  aside?: ReactNode;
  /** Quiet link above the title that goes back one level. */
  back?: { label: string; onClick: () => void };
  onClose: () => void;
  /** A landing hero rendered in place of the eyebrow/title head. The meta
   *  and aside then sit on a toolbar row under it. */
  hero?: ReactNode;
  children: ReactNode;
}

// main logic
/**
 * Shell for the /creators, /brands, /products and /catalogs pages. A
 * fixed layer under the app header (the header and its nav stay live on
 * top) with its own scroller, so the feed underneath keeps its place.
 */
export default function DirectoryPage({ eyebrow, title, meta, aside, back, onClose, hero, children }: DirectoryPageProps) {
  useEscapeKey(onClose);

  // Lock the document while the page is up (the page scrolls itself).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div className="dir-page">
      <div className="dir-page-scroll">
        <div className="dir-page-inner">
          {hero ? (
            <>
              <h1 className="dir-sr-title">{title}</h1>
              {hero}
              {(meta || aside) && (
                <div className="dir-toolbar">
                  {meta && <div className="dir-meta">{meta}</div>}
                  {aside && <div className="dir-head-aside">{aside}</div>}
                </div>
              )}
            </>
          ) : (
          <div className="dir-head">
            <div className="dir-head-main">
              {back && (
                <button type="button" className="dir-back" onClick={back.onClick}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
                  {back.label}
                </button>
              )}
              <span className="dir-eyebrow">{eyebrow}</span>
              <h1 className="dir-title">{title}</h1>
              {meta && <div className="dir-meta">{meta}</div>}
            </div>
            {aside && <div className="dir-head-aside">{aside}</div>}
          </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
