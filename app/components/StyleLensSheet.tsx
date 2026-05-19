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
 * Two scan modes:
 *   1. Full-image scan (default on first open).
 *   2. Region crop — opens StyleLensCropTool, lets the user box a
 *      single garment, uploads the crop to user-uploads, then runs
 *      lens-search against the cropped URL with the bbox recorded
 *      in the cache fingerprint.
 *
 * The wizard at /generate already hydrates the user's saved reference
 * uploads on mount, so the resulting try-on look uses the same face
 * photos visible on the Style page — no extra wiring needed for the
 * face pipeline (Phase 8 of the build plan).
 */

import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import {
  lensSearch,
  lensIngest,
  cropAndUploadLensRegion,
  type LensMatch,
  type LensBBox,
} from '~/services/lens-search';
import { useAuth } from '~/hooks/useAuth';

// Crop tool is the only consumer of the canvas-crop helper + pointer
// drag machinery, so lazy-load it so the rest of the lens sheet stays
// light when the user never taps "Crop a specific item."
const StyleLensCropTool = lazy(() => import('./StyleLensCropTool'));

interface Props {
  imageUrl: string;
  occasion: string;
  onClose: () => void;
}

// Track the active scan target so the user can flip between
// full-image and cropped scans without losing the prior result.
interface ScanTarget {
  url: string;        // image URL passed to lens-search
  bbox: LensBBox | null;
  // Whether this scan was started from a crop (only relevant for the
  // header label so users see "Cropped match" vs "Full image").
  cropped: boolean;
}

export default function StyleLensSheet({ imageUrl, occasion, onClose }: Props) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [target, setTarget] = useState<ScanTarget>({
    url: imageUrl, bbox: null, cropped: false,
  });
  const [matches, setMatches] = useState<LensMatch[] | null>(null);
  const [cachedHit, setCachedHit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Picks are stored by `link` (the merchant URL) — that's the natural
  // ingest dedupe key and it's stable across rerenders.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [tryingOn, setTryingOn] = useState(false);
  const [croppingOpen, setCroppingOpen] = useState(false);
  const [cropping, setCropping] = useState(false);

  // Esc closes the sheet. Mirrors the StyleLightbox pattern so the
  // user has a consistent dismiss behaviour across both overlays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Fire Lens search whenever the scan target changes. The occasion is
  // passed as the `q` hint so SerpAPI's Lens engine narrows from
  // "anything similar to this image" to "shoppable items that fit
  // this occasion" — a meaningful quality improvement on noisy
  // outfit collages. Picks reset on retarget so the user doesn't end
  // up trying on items from a stale scan.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPicked(new Set());
    lensSearch({ imageUrl: target.url, q: occasion, bbox: target.bbox ?? undefined }).then(result => {
      if (cancelled) return;
      if (result.error) {
        setError(result.error);
        setMatches([]);
      } else {
        setMatches(result.matches);
      }
      setCachedHit(!!result.cached);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [target.url, target.bbox, occasion]);

  function togglePick(link: string) {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(link)) next.delete(link);
      else next.add(link);
      return next;
    });
  }

  async function handleCropConfirm(bbox: LensBBox) {
    if (!user?.id || cropping) return;
    setCropping(true);
    setError(null);
    const result = await cropAndUploadLensRegion({
      userId: user.id,
      sourceImageUrl: imageUrl,
      bbox,
    });
    setCropping(false);
    if (result.error || !result.croppedUrl) {
      setError(result.error || 'Could not save the crop.');
      return;
    }
    setCroppingOpen(false);
    setTarget({ url: result.croppedUrl, bbox, cropped: true });
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
    const result = await lensIngest({ items, sourceImageUrl: target.url });
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

  // Header subtitle changes depending on whether the user has narrowed
  // the scan to a cropped region. "Cached" badge signals when a result
  // came from the lens_searches cache so the user knows why it returned
  // instantly instead of taking ~5s.
  const subtitle =
    target.cropped ? 'Cropped region' :
    occasion       ? occasion        : 'Shop this look';

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
            <span className="lens-sheet-eyebrow">
              Shop this look
              {cachedHit && <span className="lens-sheet-cached">· cached</span>}
            </span>
            <span className="lens-sheet-occasion">{subtitle}</span>
          </div>
        </header>

        <div className="lens-sheet-source">
          <img src={target.url} alt="Source look" />
          {/* Crop CTA sits on top of the source preview so it's discoverable
              the moment the user enters the lens sheet. Tapping it opens the
              crop tool against the ORIGINAL image (not the cropped target),
              so users can always re-scope from the full picture. */}
          <div className="lens-sheet-source-overlay">
            {target.cropped && (
              <button
                type="button"
                className="lens-sheet-source-chip"
                onClick={() => setTarget({ url: imageUrl, bbox: null, cropped: false })}
                title="Scan the full image again"
              >
                ← Full image
              </button>
            )}
            <button
              type="button"
              className="lens-sheet-source-chip is-primary"
              onClick={() => setCroppingOpen(true)}
              disabled={!user?.id || cropping}
            >
              {cropping ? 'Saving crop…' : target.cropped ? 'Crop again' : 'Crop a specific item'}
            </button>
          </div>
        </div>

        {loading && (
          <>
            <div className="lens-sheet-loading">
              <div className="style-tile-spinner" />
              <span>Scanning with Google Lens…</span>
            </div>
            {/* Skeleton grid fills the page below the spinner so the
                layout doesn't jump when the real results land —
                roughly the same number of cards we expect SerpAPI to
                return. */}
            <ul className="lens-sheet-grid" aria-hidden="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <li key={i} className="lens-card lens-card--skeleton">
                  <div className="lens-card-image" />
                  <div className="lens-card-body">
                    <span className="lens-card-skeleton-line lens-card-skeleton-line--short" />
                    <span className="lens-card-skeleton-line" />
                    <span className="lens-card-skeleton-line lens-card-skeleton-line--short" />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {!loading && error && (
          <div className="style-error">{error}</div>
        )}

        {!loading && matches && matches.length === 0 && !error && (
          <div className="lens-sheet-empty">
            Google Lens didn't find shoppable matches for this image.
            Try cropping a specific garment.
          </div>
        )}

        {!loading && matches && matches.length > 0 && (
          <ul className="lens-sheet-grid">
            {matches.map(m => {
              const isPicked = picked.has(m.link);
              const thumb = m.thumbnail || m.image;
              const alreadyIngested = !!m.ingested_product_id;
              return (
                <li
                  key={m.link}
                  className={`lens-card${isPicked ? ' is-picked' : ''}${alreadyIngested ? ' is-ingested' : ''}`}
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
                      {alreadyIngested && !isPicked && (
                        <span className="lens-card-ingested" aria-label="Already in your catalog">
                          In catalog
                        </span>
                      )}
                    </div>
                    <div className="lens-card-body">
                      {m.brand && <span className="lens-card-brand">{m.brand}</span>}
                      <span className="lens-card-title">{m.title}</span>
                      <div className="lens-card-meta">
                        {m.price && <span className="lens-card-price">{m.price}</span>}
                        {m.source && (
                          <span className="lens-card-source">
                            {m.source_icon && (
                              <img
                                className="lens-card-source-favicon"
                                src={m.source_icon}
                                alt=""
                                loading="lazy"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            )}
                            <span>{m.source}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                  {/* Open the merchant URL in a new tab without picking
                      — gives the user an out for "I just want to see it
                      first" without conflating with the try-on flow.
                      stopPropagation so the card's pick button doesn't
                      also fire. */}
                  <a
                    href={m.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="lens-card-external"
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Open ${m.source || 'merchant'} in new tab`}
                    title="Open merchant page"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                      <polyline points="15 3 21 3 21 9"/>
                      <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                  </a>
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

      {croppingOpen && (
        <Suspense fallback={null}>
          <StyleLensCropTool
            imageUrl={imageUrl}
            onCancel={() => setCroppingOpen(false)}
            onConfirm={handleCropConfirm}
          />
        </Suspense>
      )}
    </div>
  );
}
