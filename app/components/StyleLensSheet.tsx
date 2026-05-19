/**
 * StyleLensSheet — full overlay that opens from a Style sheet image
 * lightbox when the user taps "Shop this look." Pipes the image
 * through the lens-search edge function (SerpAPI Google Lens), shows
 * the visual matches as a Catalog-style grid, lets the user select
 * one or more, and on "Try this on" persists the picks via
 * lens-ingest then deep-links into /generate with the first pick
 * pre-selected and the Style sheet's occasion forwarded as a prompt
 * hint.
 *
 * The wizard at /generate already hydrates the user's saved reference
 * uploads on mount, so the resulting try-on look uses the same face
 * photos visible on the Style page — no extra wiring needed for the
 * face pipeline (Phase 8 of the build plan).
 */

import { useEffect, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { lensSearch, lensIngest, type LensMatch } from '~/services/lens-search';

interface Props {
  imageUrl: string;
  occasion: string;
  onClose: () => void;
}

export default function StyleLensSheet({ imageUrl, occasion, onClose }: Props) {
  const navigate = useNavigate();
  const [matches, setMatches] = useState<LensMatch[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Picks are stored by `link` (the merchant URL) — that's the natural
  // ingest dedupe key and it's stable across rerenders.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [tryingOn, setTryingOn] = useState(false);

  // Esc closes the sheet. Mirrors the StyleLightbox pattern so the
  // user has a consistent dismiss behaviour across both overlays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Fire Lens search on mount. The occasion is passed as the `q` hint
  // so SerpAPI's Lens engine narrows from "anything similar to this
  // image" to "shoppable items that fit this occasion" — a meaningful
  // quality improvement on noisy outfit collages.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    lensSearch({ imageUrl, q: occasion }).then(result => {
      if (cancelled) return;
      if (result.error) {
        setError(result.error);
        setMatches([]);
      } else {
        setMatches(result.matches);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [imageUrl, occasion]);

  function togglePick(link: string) {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(link)) next.delete(link);
      else next.add(link);
      return next;
    });
  }

  async function handleTryOn() {
    if (!matches || picked.size === 0 || tryingOn) return;
    setTryingOn(true);
    setError(null);
    const items = matches.filter(m => picked.has(m.link)).map(m => ({
      name: m.title,
      url: m.link,
      image_url: m.image || m.thumbnail,
      brand: m.brand || null,
      price: m.price || null,
    }));
    const result = await lensIngest({ items, sourceImageUrl: imageUrl });
    if (result.error) {
      setError(result.error);
      setTryingOn(false);
      return;
    }
    // Deep-link into /generate with the first successfully-ingested
    // product preselected. The wizard already hydrates the user's
    // saved reference uploads on mount so the resulting look uses the
    // same face photos visible on /style. `occasion` rides along so
    // we can fold it into the style prompt downstream.
    const firstWithId = result.ingested.find(r => r.id);
    if (!firstWithId) {
      setError('Could not save the selected items. Try again.');
      setTryingOn(false);
      return;
    }
    const params = new URLSearchParams();
    params.set('product_url', firstWithId.url);
    if (occasion) params.set('occasion', occasion);
    navigate(`/generate?${params.toString()}`);
  }

  return (
    <div className="lens-sheet" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="lens-sheet-inner" onClick={e => e.stopPropagation()}>
        <header className="lens-sheet-header">
          <button
            type="button"
            className="lens-sheet-close"
            onClick={onClose}
            aria-label="Close"
          >×</button>
          <div className="lens-sheet-title-block">
            <span className="lens-sheet-eyebrow">Shop this look</span>
            {occasion && <span className="lens-sheet-occasion">{occasion}</span>}
          </div>
        </header>

        <div className="lens-sheet-source">
          <img src={imageUrl} alt="Source look" />
        </div>

        {loading && (
          <div className="lens-sheet-loading">
            <div className="style-tile-spinner" />
            <span>Scanning with Google Lens…</span>
          </div>
        )}

        {!loading && error && (
          <div className="style-error">{error}</div>
        )}

        {!loading && matches && matches.length === 0 && !error && (
          <div className="lens-sheet-empty">
            Google Lens didn't find shoppable matches for this image.
            Try a different look from your Style sheet.
          </div>
        )}

        {!loading && matches && matches.length > 0 && (
          <ul className="lens-sheet-grid">
            {matches.map(m => {
              const isPicked = picked.has(m.link);
              const thumb = m.thumbnail || m.image;
              return (
                <li
                  key={m.link}
                  className={`lens-card${isPicked ? ' is-picked' : ''}`}
                >
                  <button
                    type="button"
                    className="lens-card-button"
                    onClick={() => togglePick(m.link)}
                    aria-pressed={isPicked}
                  >
                    <div className="lens-card-image">
                      {thumb ? <img src={thumb} alt={m.title} loading="lazy" /> : null}
                      {isPicked && (
                        <span className="lens-card-check" aria-hidden="true">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </span>
                      )}
                    </div>
                    <div className="lens-card-body">
                      {m.brand && <span className="lens-card-brand">{m.brand}</span>}
                      <span className="lens-card-title">{m.title}</span>
                      <div className="lens-card-meta">
                        {m.price && <span className="lens-card-price">{m.price}</span>}
                        {m.source && <span className="lens-card-source">{m.source}</span>}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Sticky CTA dock. Stays disabled until the user picks at least
          one match. Pick count + Try-it-on action live here so the
          shopping grid stays scrollable behind without competing for
          the bottom-of-viewport real estate. */}
      <div className="lens-sheet-dock">
        <div className="lens-sheet-dock-count">
          {picked.size === 0
            ? 'Tap items to add them to your try-on'
            : `${picked.size} selected`}
        </div>
        <button
          type="button"
          className="style-primary"
          onClick={handleTryOn}
          disabled={picked.size === 0 || tryingOn}
        >
          {tryingOn ? 'Saving…' : 'Try this on'}
        </button>
      </div>
    </div>
  );
}
