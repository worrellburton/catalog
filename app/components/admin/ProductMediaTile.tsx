// imports
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  onGenerateAll: () => void;
  onGenerateImage: () => void;
}

// constants
const STEPS: Array<{ key: 'polished' | 'poster' | 'video'; label: string }> = [
  { key: 'polished', label: 'Polished image' },
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

// main logic
/** The whole Media column in one tile: the product's best media (video →
 *  poster → primary image), a three-step completion meter along its foot,
 *  and a Generate menu — the full set (pick → polish → video → poster) or
 *  just the polished image. */
export default function ProductMediaTile({
  media, imageUrl, videoUrl, posterUrl, videoFailed, busy, fallbackLogo,
  canGenerate, onOpen, onGenerateAll, onGenerateImage,
}: ProductMediaTileProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const missing = STEPS.filter(s => !media[s.key]);
  const title = `Media ${media.done}/3 — ${STEPS.map(s => `${media[s.key] ? '✓' : '✗'} ${s.label}`).join(' · ')}`;

  return (
    <div className={`admin-media-tile is-${media.level}${busy ? ' is-busy' : ''}`} onClick={e => e.stopPropagation()}>
      <button type="button" className="admin-media-tile-frame" onClick={onOpen} title={`${title}\nClick to open the photo gallery`}>
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
        <span className="admin-media-tile-meter" aria-label={`Media ${media.done} of 3 complete`}>
          {STEPS.map(s => <span key={s.key} className={media[s.key] ? 'is-done' : ''} />)}
        </span>
      </button>
      {canGenerate && (
        <button
          ref={triggerRef}
          type="button"
          className="admin-media-tile-gen"
          onClick={() => setMenuOpen(v => !v)}
          disabled={!!busy}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={busy ? 'Generating…' : 'Generate media'}
        >
          <svg width="11" height="11" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">
            <path d="M50 4 C54 30 70 46 96 50 C70 54 54 70 50 96 C46 70 30 54 4 50 C30 46 46 30 50 4 Z" />
          </svg>
        </button>
      )}
      {menuOpen && (
        <GenerateMenu
          anchor={triggerRef.current}
          media={media}
          missingCount={missing.length}
          onClose={() => setMenuOpen(false)}
          onGenerateAll={() => { setMenuOpen(false); onGenerateAll(); }}
          onGenerateImage={() => { setMenuOpen(false); onGenerateImage(); }}
        />
      )}
    </div>
  );
}

// helpers
interface GenerateMenuProps {
  anchor: HTMLElement | null;
  media: MediaCompletion;
  missingCount: number;
  onClose: () => void;
  onGenerateAll: () => void;
  onGenerateImage: () => void;
}

/** Portaled to <body> so the table's scroll container can't clip it. */
function GenerateMenu({ anchor, media, missingCount, onClose, onGenerateAll, onGenerateImage }: GenerateMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const width = 248;
    const left = Math.min(Math.max(8, r.left - 8), window.innerWidth - width - 8);
    const below = r.bottom + 6;
    const top = below + 190 > window.innerHeight ? Math.max(8, r.top - 196) : below;
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchor, onClose]);

  if (!pos || typeof document === 'undefined') return null;
  const complete = missingCount === 0;
  const dark = !!anchor?.closest('.admin-dark');
  return createPortal(
    <div ref={menuRef} role="menu" className={`admin-media-gen-menu${dark ? ' is-dark' : ''}`} style={{ top: pos.top, left: pos.left }} onClick={e => e.stopPropagation()}>
      <div className="admin-media-gen-steps">
        {STEPS.map(s => (
          <span key={s.key} className={media[s.key] ? 'is-done' : ''}>
            <i aria-hidden="true" />{s.label}
          </span>
        ))}
      </div>
      <button type="button" role="menuitem" className="admin-media-gen-item" onClick={onGenerateAll} disabled={complete}>
        <strong>Generate everything</strong>
        <span>{complete ? 'All three are done' : `Fills the ${missingCount} missing step${missingCount === 1 ? '' : 's'}: image → video → poster`}</span>
      </button>
      <button type="button" role="menuitem" className="admin-media-gen-item" onClick={onGenerateImage}>
        <strong>{media.polished ? 'Re-polish image' : 'Image only'}</strong>
        <span>Polish the primary into a clean 3:4 packshot</span>
      </button>
    </div>,
    document.body,
  );
}
