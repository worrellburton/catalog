// imports
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from '@remix-run/react';
import type { MediaCompletion } from '~/utils/product-health';

// types
export type MediaBusy = 'pick' | 'polish' | 'video' | 'rendering' | 'poster' | null;

interface ProductMediaTileProps {
  media: MediaCompletion;
  /** Primary image, falling back to the scraped hero image. */
  imageUrl: string | null;
  videoUrl: string | null;
  posterUrl: string | null;
  videoFailed: boolean;
  busy: MediaBusy;
  /** Brand logo shown when the product has no imagery at all. */
  fallbackLogo?: string | null;
  canGenerate: boolean;
  onOpen: () => void;
  /** Admin product page for this product. */
  pageHref?: string | null;
  onGenerateImage: () => void;
  onGenerateVideo: () => void;
}

// constants
const STEPS: Array<{ key: 'polished' | 'poster' | 'video'; label: string }> = [
  { key: 'polished', label: 'Image' },
  { key: 'poster', label: 'Poster' },
  { key: 'video', label: 'Video' },
];

const BUSY_LABEL: Record<Exclude<MediaBusy, null>, string> = {
  pick: 'Pick',
  polish: 'Polish',
  video: 'Queue',
  rendering: 'Video',
  poster: 'Poster',
};

const BUSY_DETAIL: Record<Exclude<MediaBusy, null>, string> = {
  pick: 'Picking the best product photo…',
  polish: 'Polishing into a 3:4 primary image…',
  video: 'Sending the video to render…',
  rendering: 'Rendering the video…',
  poster: 'Cutting the poster frame…',
};

const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 180;
const CARD_WIDTH = 264;

// main logic
/** The whole Media column in one tile: the product's best media (video →
 *  poster → primary image) with a three-step meter along its foot. Hovering
 *  it opens a card to open the product card, or run the image sequence
 *  (pick → polish into the primary image) or the video sequence (image
 *  first if needed, then the video; the poster follows). */
export default function ProductMediaTile({
  media, imageUrl, videoUrl, posterUrl, videoFailed, busy, fallbackLogo,
  canGenerate, onOpen, pageHref, onGenerateImage, onGenerateVideo,
}: ProductMediaTileProps) {
  const [cardOpen, setCardOpen] = useState(false);
  const frameRef = useRef<HTMLButtonElement | null>(null);
  const timer = useRef<number | null>(null);

  const clearTimer = () => { if (timer.current != null) { window.clearTimeout(timer.current); timer.current = null; } };
  const scheduleOpen = () => { clearTimer(); timer.current = window.setTimeout(() => setCardOpen(true), OPEN_DELAY_MS); };
  const scheduleClose = () => { clearTimer(); timer.current = window.setTimeout(() => setCardOpen(false), CLOSE_DELAY_MS); };
  const close = useCallback(() => { clearTimer(); setCardOpen(false); }, []);
  useEffect(() => clearTimer, []);

  return (
    <div
      className={`admin-media-tile is-${media.level}${busy ? ' is-busy' : ''}`}
      onClick={e => e.stopPropagation()}
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={frameRef}
        type="button"
        className="admin-media-tile-frame"
        onClick={() => { close(); onOpen(); }}
        onFocus={() => setCardOpen(true)}
        aria-label={`Media ${media.done} of 3 complete — open product card`}
      >
        {videoUrl ? (
          <video src={videoUrl} poster={posterUrl || imageUrl || undefined} autoPlay muted loop playsInline preload="metadata" />
        ) : imageUrl ? (
          <img src={imageUrl} alt="" loading="lazy" />
        ) : fallbackLogo ? (
          <img src={fallbackLogo} alt="" className="admin-media-tile-logo" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        ) : (
          <span className="admin-media-tile-empty" aria-hidden="true">☆</span>
        )}
        {busy && (
          <span className="admin-media-tile-busy">
            <span className="admin-media-tile-spinner" aria-hidden="true" />
            {BUSY_LABEL[busy]}
          </span>
        )}
        {!busy && videoFailed && !videoUrl && <span className="admin-media-tile-flag" title="Last video render failed">!</span>}
        <span className="admin-media-tile-meter" aria-hidden="true">
          {STEPS.map(s => <span key={s.key} className={media[s.key] ? 'is-done' : ''} />)}
        </span>
      </button>
      {cardOpen && (
        <MediaHoverCard
          anchor={frameRef.current}
          media={media}
          busy={busy}
          videoFailed={videoFailed && !videoUrl}
          canGenerate={canGenerate}
          onEnter={clearTimer}
          onLeave={scheduleClose}
          onClose={close}
          onOpen={() => { close(); onOpen(); }}
          pageHref={pageHref ?? null}
          onGenerateImage={() => { close(); onGenerateImage(); }}
          onGenerateVideo={() => { close(); onGenerateVideo(); }}
        />
      )}
    </div>
  );
}

// helpers
interface MediaHoverCardProps {
  anchor: HTMLElement | null;
  media: MediaCompletion;
  busy: MediaBusy;
  videoFailed: boolean;
  canGenerate: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
  onOpen: () => void;
  pageHref: string | null;
  onGenerateImage: () => void;
  onGenerateVideo: () => void;
}

/** Portaled to <body> so the table's scroll container can't clip it. Sits
 *  beside the tile (flips left near the viewport edge). */
function MediaHoverCard({
  anchor, media, busy, videoFailed, canGenerate, onEnter, onLeave, onClose, onOpen, pageHref, onGenerateImage, onGenerateVideo,
}: MediaHoverCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const h = cardRef.current?.offsetHeight ?? 220;
    const right = r.right + 10;
    const left = right + CARD_WIDTH + 8 > window.innerWidth ? Math.max(8, r.left - CARD_WIDTH - 10) : right;
    const top = Math.min(Math.max(8, r.top - 6), window.innerHeight - h - 8);
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onScroll = (e: Event) => { if (!cardRef.current?.contains(e.target as Node)) onClose(); };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!cardRef.current?.contains(t) && !anchor?.contains(t)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchor, onClose]);

  if (typeof document === 'undefined') return null;
  const dark = !!anchor?.closest('.admin-dark');
  const locked = !!busy || !canGenerate;
  return createPortal(
    <div
      ref={cardRef}
      role="menu"
      className={`admin-media-card${dark ? ' is-dark' : ''}`}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: CARD_WIDTH }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={e => e.stopPropagation()}
    >
      <div className="admin-media-card-head">
        <span className="admin-media-card-title">Media {media.done}/3</span>
        <span className="admin-media-card-steps">
          {STEPS.map(s => (
            <span key={s.key} className={media[s.key] ? 'is-done' : ''}><i aria-hidden="true" />{s.label}</span>
          ))}
        </span>
      </div>
      {busy && (
        <div className="admin-media-card-status">
          <span className="admin-media-tile-spinner" aria-hidden="true" />{BUSY_DETAIL[busy]}
        </div>
      )}
      {!busy && videoFailed && <div className="admin-media-card-status is-error">Last video render failed — generate it again.</div>}
      <button type="button" role="menuitem" className="admin-media-card-item" onClick={onOpen}>
        <strong>Open product card</strong>
        <span>Photos, primary pick and creative, inline</span>
      </button>
      {pageHref && (
        <Link role="menuitem" className="admin-media-card-item" to={pageHref} onClick={onClose}>
          <strong>Open product page</strong>
          <span>Everything about this product</span>
        </Link>
      )}
      <button type="button" role="menuitem" className="admin-media-card-item" onClick={onGenerateImage} disabled={locked}>
        <strong>{media.polished ? 'Regenerate image' : 'Generate image'}</strong>
        <span>Polish the photo into the primary image</span>
      </button>
      <button type="button" role="menuitem" className="admin-media-card-item is-primary" onClick={onGenerateVideo} disabled={locked}>
        <strong>{media.video ? 'Regenerate video' : 'Generate video'}</strong>
        <span>{media.polished ? 'Renders the video from the primary image' : 'Does the image first, then the video'}</span>
      </button>
      {!canGenerate && <p className="admin-media-card-note">No product photos to work from yet.</p>}
    </div>,
    document.body,
  );
}
