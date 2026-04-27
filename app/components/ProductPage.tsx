import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Product, Look, creators as staticCreators } from '~/data/looks';
import { useEscapeKey } from '~/hooks/useEscapeKey';
import CreativeCard from '~/components/CreativeCard';
import { useTrailVideo } from '~/components/TrailVideoHost';
import { TrailMorph } from '~/components/TrailMotion';
import { trackAdClick, prefetchSimilarCreatives, type ProductAd } from '~/services/product-creative';

interface ProductPageCreative {
  /** The product_creative.id — used to resolve the shared <video> element
   *  from TrailVideoHost so the morph reuses the card's playing instance. */
  id?: string;
  videoUrl: string;
  thumbnailUrl?: string | null;
}

interface BookmarksInterface {
  isProductBookmarked: (p: Product) => boolean;
  toggleProductBookmark: (p: Product) => void;
}

interface ProductPageProps {
  product: Product;
  onClose: () => void;
  onOpenLook: (look: Look) => void;
  onOpenBrowser: (url: string, title: string) => void;
  onOpenProduct?: (product: Product) => void;
  onOpenCreator?: (name: string) => void;
  onOpenCreative?: (creative: ProductAd) => void;
  creative?: ProductPageCreative;
  /** Visually-similar creatives from TwelveLabs/pgvector. Rendered as the
   *  "More like this" video rail below the hero. */
  similarCreatives?: ProductAd[];
  /** Other live creatives from the same brand. Rendered as the
   *  horizontally-scrolling "More from this brand" strip. */
  brandCreatives?: ProductAd[];
  /** Editorial fashion looks (Look[]) — drives the "You might also like"
   *  grid below the trail rail. Tap opens the look in LookOverlay. */
  lookCreatives?: Look[];
  bookmarks: BookmarksInterface;
}

// Stable hash of any string → unsigned integer. Used to derive a consistent
// dummy save count + "saved by" avatar set per product so refreshing the
// page doesn't reshuffle the social-proof row.
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Curated avatar pool for the dummy "saved by" row. Sources from the
// existing static creators so the avatars are real images (no third-party
// avatar generators / extra network hops).
const AVATAR_POOL = Object.values(staticCreators)
  .filter(c => !!c.avatar)
  .slice(0, 12);

interface SavedByDummy { count: number; avatars: { name: string; avatar: string }[] }
function dummySavedBy(productKey: string): SavedByDummy {
  if (AVATAR_POOL.length === 0) return { count: 0, avatars: [] };
  const h = hashString(productKey);
  // 47–527 is a plausible "interesting but not insane" range for a curated
  // catalog product. Bias the low end so most products read as believable.
  const count = 47 + (h % 481);
  const start = h % AVATAR_POOL.length;
  const visibleN = Math.min(5, AVATAR_POOL.length);
  const avatars = Array.from({ length: visibleN }, (_, i) => AVATAR_POOL[(start + i) % AVATAR_POOL.length]);
  return { count, avatars };
}

/** Compact video tile for the brand strip — small, no overlay info,
 *  keeps the trail going on tap by reusing the shared <video> element. */
function BrandStripTile({ creative, onOpen }: { creative: ProductAd; onOpen: (c: ProductAd) => void }) {
  const [loaded, setLoaded] = useState(false);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const setSlot = useTrailVideo(creative.id, creative.video_url ?? undefined);
  const setRef = useCallback((node: HTMLDivElement | null) => {
    slotRef.current = node;
    setSlot(node);
  }, [setSlot]);
  // Mark loaded once the host's video has frames (so the dim placeholder lifts).
  useEffect(() => {
    const video = slotRef.current?.querySelector('video') as HTMLVideoElement | null;
    if (!video) return;
    if (video.readyState >= 2) { setLoaded(true); return; }
    const handler = () => setLoaded(true);
    ['playing', 'canplay', 'loadeddata'].forEach(e => video.addEventListener(e, handler, { once: true }));
    const t = setTimeout(() => setLoaded(true), 6000);
    return () => {
      clearTimeout(t);
      ['playing', 'canplay', 'loadeddata'].forEach(e => video.removeEventListener(e, handler));
    };
  }, [creative.id]);
  return (
    <button
      type="button"
      className={`pd-brand-tile ${loaded ? 'loaded' : ''}`}
      onClick={() => { trackAdClick(creative.id); onOpen(creative); }}
      onMouseEnter={() => prefetchSimilarCreatives(creative.id, 18)}
      onTouchStart={() => prefetchSimilarCreatives(creative.id, 18)}
    >
      <TrailMorph id={creative.id} className="pd-brand-tile-morph">
        <div ref={setRef} className="pd-brand-tile-slot" data-trail-id={creative.id} />
      </TrailMorph>
    </button>
  );
}

/** Look-creative tile for the "You might also like" grid. Looks have video
 *  via the looks_creative join in services/looks.ts, mapped to look.video. */
function LookTile({ look, onOpen }: { look: Look; onOpen: (l: Look) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const obs = new IntersectionObserver(
      es => es.forEach(e => { if (e.isIntersecting) v.play().catch(() => {}); else v.pause(); }),
      { rootMargin: '200px' },
    );
    obs.observe(v);
    return () => obs.disconnect();
  }, []);
  return (
    <button type="button" className="pd-look-tile" onClick={() => onOpen(look)}>
      <video
        ref={videoRef}
        src={look.video}
        muted
        loop
        playsInline
        preload="metadata"
        className="pd-look-tile-video"
      />
      <div className="pd-look-tile-meta">
        <span className="pd-look-tile-title">{look.title}</span>
        {look.creator && <span className="pd-look-tile-creator">{look.creator}</span>}
      </div>
    </button>
  );
}

export default function ProductPage({
  product,
  onClose,
  onOpenLook,
  onOpenBrowser,
  onOpenCreative,
  creative,
  similarCreatives,
  brandCreatives,
  lookCreatives,
  bookmarks,
}: ProductPageProps) {
  const [mounted, setMounted] = useState(false);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  // Reset scroll to top when the product changes (user tapped a similar
  // product and we swapped state in-place).
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [product.brand, product.name]);

  const handleClose = useCallback(() => {
    setIsAnimatingOut(true);
    setTimeout(onClose, 320);
  }, [onClose]);

  useEscapeKey(handleClose);

  const isSaved = bookmarks.isProductBookmarked(product);
  const handleToggleSave = useCallback(() => {
    bookmarks.toggleProductBookmark(product);
  }, [bookmarks, product]);

  // Dummy social proof. Stable per product so the count + avatars don't
  // reshuffle on every re-render. Wire to a real `product_saves` table when
  // we ship it.
  const savedBy = useMemo(
    () => dummySavedBy(`${product.brand}|${product.name}`),
    [product.brand, product.name],
  );

  const heroClassName = `pd-hero${creative ? ' pd-hero--video' : product.image ? ' pd-hero--image' : ' pd-hero--empty'}`;

  // Take ownership of the shared <video> element keyed by creative.id. The
  // TrailVideoHost moves the running DOM node from the card slot into this
  // hero slot — appendChild preserves currentTime + decoded frames, so there
  // is no reload, no black flash, no audio gap.
  const setHeroSlot = useTrailVideo(creative?.id, creative?.videoUrl);

  return (
    <div
      className={`product-page-overlay${mounted && !isAnimatingOut ? ' product-page-overlay--in' : ''}${isAnimatingOut ? ' product-page-overlay--out' : ''}`}
      role="dialog"
      aria-modal="true"
    >
      <div className="product-page" ref={scrollerRef}>
        <button
          className="pd-back"
          onClick={handleClose}
          aria-label="Back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <section className={heroClassName}>
          {creative ? (
            creative.id ? (
              <TrailMorph id={creative.id} className="pd-hero-media pd-hero-video-slot">
                <div ref={setHeroSlot} style={{ width: '100%', height: '100%' }} data-trail-id={creative.id} />
              </TrailMorph>
            ) : (
              <div ref={setHeroSlot} className="pd-hero-media pd-hero-video-slot" />
            )
          ) : product.image ? (
            <img
              src={product.image.replace('w=200&h=200', 'w=1200&h=1600')}
              alt={product.name}
              className="pd-hero-media"
            />
          ) : (
            <div className="pd-hero-placeholder" />
          )}
          <div className="pd-hero-scrim" />
        </section>

        <section className="pd-info">
          <div className="pd-info-inner">
            {product.brand && <div className="pd-brand">{product.brand}</div>}
            <h1 className="pd-name">{product.name}</h1>
            {product.price && <div className="pd-price">{product.price}</div>}

            {/* Saved-by social-proof row. Dummy data today — wired to
                bookmark-based save counts when the product_saves table ships. */}
            {savedBy.avatars.length > 0 && (
              <div className="pd-saved-by" aria-label={`Saved by ${savedBy.count} shoppers`}>
                <div className="pd-saved-avatars">
                  {savedBy.avatars.map((a, i) => (
                    <img
                      key={a.name}
                      src={a.avatar}
                      alt=""
                      className="pd-saved-avatar"
                      style={{ zIndex: savedBy.avatars.length - i }}
                      loading="lazy"
                    />
                  ))}
                </div>
                <span className="pd-saved-count">
                  Saved by <strong>{savedBy.count.toLocaleString()}</strong>
                </span>
              </div>
            )}

            <div className="pd-actions">
              <button
                type="button"
                className="pd-shop-btn"
                onClick={() => product.url && onOpenBrowser(product.url, product.name)}
                disabled={!product.url}
              >
                Shop on {product.brand || 'site'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="7" y1="17" x2="17" y2="7" />
                  <polyline points="7 7 17 7 17 17" />
                </svg>
              </button>
              <button
                type="button"
                className={`pd-bookmark-btn ${isSaved ? 'is-saved' : ''}`}
                onClick={handleToggleSave}
                aria-label={isSaved ? 'Remove from bookmarks' : 'Save product'}
                aria-pressed={isSaved}
              >
                {/* Filled vs outline bookmark — toggles on tap */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
                <span>{isSaved ? 'Saved' : 'Save'}</span>
              </button>
            </div>
          </div>
        </section>

        {brandCreatives && brandCreatives.length > 0 && (
          <section className="pd-brand-strip-section" aria-label="More from this brand">
            <h2 className="pd-feed-title">More from {product.brand || 'this brand'}</h2>
            <div className="pd-brand-strip">
              {brandCreatives.slice(0, 12).map(c => (
                onOpenCreative
                  ? <BrandStripTile key={c.id} creative={c} onOpen={onOpenCreative} />
                  : null
              ))}
            </div>
          </section>
        )}

        {similarCreatives && similarCreatives.length > 0 && (
          <section className="pd-similar-feed">
            <h2 className="pd-feed-title">More like this</h2>
            <div className="pd-similar-grid">
              {/* CreativeCard handles the layoutId morph + shared video element
                  so a tap here continues the trail with the same fluid handoff. */}
              {similarCreatives.map(c => (
                <CreativeCard
                  key={c.id}
                  creative={c}
                  className="look-card"
                  onOpenProduct={onOpenCreative}
                />
              ))}
            </div>
          </section>
        )}

        {lookCreatives && lookCreatives.length > 0 && (
          <section className="pd-look-feed">
            <h2 className="pd-feed-title">You might also like</h2>
            <div className="pd-look-grid">
              {lookCreatives.slice(0, 12).map(l => (
                <LookTile key={l.id} look={l} onOpen={onOpenLook} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
