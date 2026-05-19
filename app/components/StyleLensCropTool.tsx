/**
 * StyleLensCropTool — draggable rectangle the user pulls over a Style
 * sheet image to scope a Lens search to one specific garment / detail.
 *
 * The rectangle is reported in 0..1 image-space so the parent can
 * forward it verbatim to lens-search (which uses it both as the cache
 * fingerprint component and to determine whether to ask the client
 * to upload a cropped JPEG).
 *
 * Pointer events unify mouse + touch so the same code paths work on
 * iOS, Android, and desktop. Eight resize handles + a drag-the-whole-
 * rect interaction keeps the manipulation familiar; constraining
 * inside the image bounds means we can never emit an out-of-image
 * bbox.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LensBBox } from '~/services/lens-search';

interface Props {
  imageUrl: string;
  onCancel: () => void;
  onConfirm: (bbox: LensBBox) => void;
}

// Initial bbox covers the middle 60% of the image so the user starts
// from a plausible "centre of the frame" crop rather than an arbitrary
// corner. Resizing is cheap from here.
const INITIAL: LensBBox = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 };

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type DragMode = { kind: 'move' } | { kind: 'resize'; handle: Handle };

interface DragState {
  startX: number;
  startY: number;
  startBox: LensBBox;
  mode: DragMode;
  rectW: number;
  rectH: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export default function StyleLensCropTool({ imageUrl, onCancel, onConfirm }: Props) {
  const [bbox, setBbox] = useState<LensBBox>(INITIAL);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  // Esc cancels so the crop tool follows the same dismiss pattern as
  // the rest of the Style overlays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Helper to read the current image bounds in screen pixels — the
  // rectangle's onscreen position is computed from bbox * these
  // dimensions, and pointer deltas are converted back into image-space
  // by dividing by them.
  function getRect(): { w: number; h: number } | null {
    const el = stageRef.current?.querySelector('img');
    if (!el) return null;
    const r = (el as HTMLImageElement).getBoundingClientRect();
    return { w: r.width, h: r.height };
  }

  function startDrag(
    e: React.PointerEvent<HTMLElement>,
    mode: DragMode,
  ) {
    e.stopPropagation();
    e.preventDefault();
    const r = getRect();
    if (!r) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startBox: { ...bbox },
      mode,
      rectW: r.w,
      rectH: r.h,
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLElement>) {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / d.rectW;
    const dy = (e.clientY - d.startY) / d.rectH;
    setBbox(prev => updateBbox(d.startBox, d.mode, dx, dy) ?? prev);
  }

  function onPointerUp(e: React.PointerEvent<HTMLElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch { /* not captured */ }
  }

  const overlayStyle = useMemo(() => ({
    left: `${bbox.x * 100}%`,
    top: `${bbox.y * 100}%`,
    width: `${bbox.w * 100}%`,
    height: `${bbox.h * 100}%`,
  }), [bbox]);

  return (
    <div className="lens-crop" role="dialog" aria-modal="true">
      <header className="lens-crop-header">
        <button type="button" className="lens-sheet-close" onClick={onCancel} aria-label="Cancel">×</button>
        <div className="lens-sheet-title-block">
          <span className="lens-sheet-eyebrow">Crop a specific item</span>
          <span className="lens-sheet-occasion">Drag the box around one garment</span>
        </div>
      </header>
      <div className="lens-crop-stage" ref={stageRef}>
        <img src={imageUrl} alt="Source look" draggable={false} />
        {/* The dimming overlays paint around the bbox so the user can
            see what's in vs out of scope without the rectangle line
            getting lost in a busy background. */}
        <div
          className="lens-crop-rect"
          style={overlayStyle}
          onPointerDown={(e) => startDrag(e, { kind: 'move' })}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {(['nw','n','ne','e','se','s','sw','w'] as Handle[]).map(h => (
            <span
              key={h}
              className={`lens-crop-handle lens-crop-handle-${h}`}
              onPointerDown={(e) => startDrag(e, { kind: 'resize', handle: h })}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          ))}
        </div>
      </div>
      <footer className="lens-crop-dock">
        <button type="button" className="lens-sheet-dock-count lens-crop-reset" onClick={() => setBbox(INITIAL)}>
          Reset
        </button>
        <button type="button" className="style-primary" onClick={() => onConfirm(bbox)}>
          Search this area
        </button>
      </footer>
    </div>
  );
}

// Constrain the new bbox inside the unit square AND enforce a 5%
// minimum dimension so the user can't drag the box to a sliver
// pickup-area Lens can't make anything of.
const MIN = 0.05;

function updateBbox(
  start: LensBBox,
  mode: DragMode,
  dx: number,
  dy: number,
): LensBBox | null {
  if (mode.kind === 'move') {
    return {
      x: clamp(start.x + dx, 0, 1 - start.w),
      y: clamp(start.y + dy, 0, 1 - start.h),
      w: start.w,
      h: start.h,
    };
  }

  let { x, y, w, h } = start;
  switch (mode.handle) {
    case 'nw': {
      const nx = clamp(start.x + dx, 0, start.x + start.w - MIN);
      const ny = clamp(start.y + dy, 0, start.y + start.h - MIN);
      w = start.w + (start.x - nx);
      h = start.h + (start.y - ny);
      x = nx; y = ny;
      break;
    }
    case 'n': {
      const ny = clamp(start.y + dy, 0, start.y + start.h - MIN);
      h = start.h + (start.y - ny);
      y = ny;
      break;
    }
    case 'ne': {
      const ny = clamp(start.y + dy, 0, start.y + start.h - MIN);
      w = clamp(start.w + dx, MIN, 1 - start.x);
      h = start.h + (start.y - ny);
      y = ny;
      break;
    }
    case 'e': {
      w = clamp(start.w + dx, MIN, 1 - start.x);
      break;
    }
    case 'se': {
      w = clamp(start.w + dx, MIN, 1 - start.x);
      h = clamp(start.h + dy, MIN, 1 - start.y);
      break;
    }
    case 's': {
      h = clamp(start.h + dy, MIN, 1 - start.y);
      break;
    }
    case 'sw': {
      const nx = clamp(start.x + dx, 0, start.x + start.w - MIN);
      w = start.w + (start.x - nx);
      h = clamp(start.h + dy, MIN, 1 - start.y);
      x = nx;
      break;
    }
    case 'w': {
      const nx = clamp(start.x + dx, 0, start.x + start.w - MIN);
      w = start.w + (start.x - nx);
      x = nx;
      break;
    }
  }
  return { x, y, w, h };
}
