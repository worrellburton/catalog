// InAppBrowser — slide-up overlay that frames a third-party retailer URL in
// an iframe, with persistent header chrome (back, save-product chip,
// open-in-real-browser fallback). Replaces the previous window.open path so
// shoppers stay inside the catalog while exploring.
//
// Iframe caveats: most retailers block embedding via X-Frame-Options or
// CSP frame-ancestors. We can't tell from JS exactly when that fires, but
// we *can* watch for the iframe never firing 'load' — that's our signal to
// surface a "this site won't load here" fallback with a one-tap escape to
// a real browser tab. Brand sites on Shopify (the common case) typically
// embed fine.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Product } from '~/data/looks';

interface InAppBrowserProps {
  url: string;
  title: string;
  /** When set, a "Save" button appears in the header that toggles
   *  bookmarks for this product. */
  product?: Product;
  isSaved?: boolean;
  onToggleSave?: (product: Product) => void;
  onClose: () => void;
}

const LOAD_TIMEOUT_MS = 4000;

export default function InAppBrowser({ url, title, product, isSaved, onToggleSave, onClose }: InAppBrowserProps) {
  const [mounted, setMounted] = useState(false);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  // If the iframe doesn't fire 'load' within the budget, assume the
  // retailer's frame-ancestors / XFO blocked us and offer the escape hatch.
  useEffect(() => {
    setBlocked(false);
    setLoaded(false);
    const t = window.setTimeout(() => {
      if (!iframeRef.current) return;
      if (!loaded) setBlocked(true);
    }, LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [url, loaded]);

  const handleClose = useCallback(() => {
    setIsAnimatingOut(true);
    setTimeout(onClose, 320);
  }, [onClose]);

  // Escape closes the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleClose]);

  const escapeToTab = useCallback(() => {
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [url]);

  const cls = [
    'in-app-browser',
    mounted && !isAnimatingOut ? 'in-app-browser--in' : '',
    isAnimatingOut ? 'in-app-browser--out' : '',
  ].filter(Boolean).join(' ');

  // Try to extract a hostname for the title bar — fall back to the title
  // prop the caller gave us.
  let hostname = '';
  try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch { /* invalid url */ }

  return (
    <div className={cls} role="dialog" aria-modal="true" aria-label={`Browsing ${hostname || title}`}>
      <div className="iab-header">
        <button className="iab-close" onClick={handleClose} aria-label="Close browser">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div className="iab-title">
          <span className="iab-host">{hostname || title}</span>
          {title && hostname && <span className="iab-subtitle">{title}</span>}
        </div>
        <div className="iab-actions">
          {product && onToggleSave && (
            <button
              className={`iab-save${isSaved ? ' is-saved' : ''}`}
              onClick={() => onToggleSave(product)}
              aria-label={isSaved ? 'Remove from bookmarks' : 'Save product'}
              aria-pressed={isSaved}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
              <span>{isSaved ? 'Saved' : 'Save'}</span>
            </button>
          )}
          <button className="iab-popout" onClick={escapeToTab} aria-label="Open in real browser">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="iab-body">
        {blocked ? (
          <div className="iab-blocked">
            <p className="iab-blocked-headline">This site doesn't allow in-app browsing.</p>
            <p className="iab-blocked-sub">Open it in a new tab — your trail stays right here when you come back.</p>
            <button className="iab-blocked-cta" onClick={escapeToTab}>
              Open {hostname || 'site'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="7" y1="17" x2="17" y2="7"/>
                <polyline points="7 7 17 7 17 17"/>
              </svg>
            </button>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={url}
            title={title}
            className="iab-iframe"
            // Sandbox lets the page render but limits what it can do back
            // to us. allow-scripts so React-based ecom still works,
            // allow-same-origin so retailer login state persists, etc.
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer-when-downgrade"
            onLoad={() => setLoaded(true)}
          />
        )}
      </div>
    </div>
  );
}
