// Avatar upload + circle-crop flow. Wired into UserMenu via the
// AvatarUpload trigger below: tap the avatar → file picker → this
// modal opens with the chosen image, drag to pan, slider/wheel/pinch
// to zoom, save bakes a round JPEG and pushes to Supabase storage.
//
// "Make it really amazing": the staging, the controls, the save flow
// and the success ring are all animated. Animations are pure CSS
// transitions + keyframes - no framer-motion - so the bundle stays
// small.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { createPortal } from 'react-dom';

interface AvatarCropModalProps {
  /** Source image - either an http(s) URL or a blob/object URL. */
  src: string;
  /** Output dimensions of the cropped JPEG, in px. 512 is plenty for
   *  retina avatar surfaces (96px @ 4x). */
  outputSize?: number;
  /** Animate from this DOMRect on open and back to it on save/cancel.
   *  When provided, the modal performs a FLIP morph from the source
   *  avatar circle into the centered crop stage. */
  originRect?: DOMRect | null;
  busy?: boolean;
  /** Called once the user hits Save. Receives the cropped JPEG blob.
   *  Caller is responsible for the upload + close. */
  onSave: (blob: Blob) => void | Promise<void>;
  onClose: () => void;
}

const STAGE_SIZE = 320;            // px - circle diameter inside modal
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const PIXEL_RATIO = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;

interface ImageDims { w: number; h: number }

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function AvatarCropModal({
  src,
  outputSize = 512,
  originRect,
  busy = false,
  onSave,
  onClose,
}: AvatarCropModalProps) {
  const [imgDims, setImgDims] = useState<ImageDims | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [phase, setPhase] = useState<'enter' | 'open' | 'saving' | 'success' | 'leave'>('enter');
  const [internalBusy, setInternalBusy] = useState(false);
  const isBusy = busy || internalBusy;

  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgElRef = useRef<HTMLImageElement | null>(null);

  // Phase 8: open / leave animation drives via the className on the
  // wrapper. Set 'open' on the next frame so the CSS transition fires.
  useEffect(() => {
    const t = window.setTimeout(() => setPhase('open'), 16);
    return () => window.clearTimeout(t);
  }, []);

  // Esc cancels (unless the save round-trip is mid-flight).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isBusy) handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBusy]);

  // Center the image once we know its intrinsic dims.
  const onImgLoad = useCallback(() => {
    const img = imgElRef.current;
    if (!img) return;
    setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // Cover-fit the source into the stage circle. cover so the entire
  // circle is filled even when the source is non-square; the user
  // can drag to recenter and zoom further in.
  const baseScale = useMemo(() => {
    if (!imgDims) return 1;
    return Math.max(STAGE_SIZE / imgDims.w, STAGE_SIZE / imgDims.h);
  }, [imgDims]);

  // Constrain the offset so the cropped circle never reveals empty
  // background. The displayed image at scale `s` has width
  // imgDims.w * s; the circle's radius is STAGE_SIZE/2; the maximum
  // pan in either axis is `(displayed - STAGE_SIZE) / 2`.
  const constrainedOffset = useCallback(
    (raw: { x: number; y: number }, s: number): { x: number; y: number } => {
      if (!imgDims) return raw;
      const displayedW = imgDims.w * s;
      const displayedH = imgDims.h * s;
      const maxX = Math.max(0, (displayedW - STAGE_SIZE) / 2);
      const maxY = Math.max(0, (displayedH - STAGE_SIZE) / 2);
      return { x: clamp(raw.x, -maxX, maxX), y: clamp(raw.y, -maxY, maxY) };
    },
    [imgDims],
  );

  // Re-clamp the offset whenever zoom changes (so a zoom-out doesn't
  // leave the user staring at a half-empty circle).
  useEffect(() => {
    setOffset((prev) => constrainedOffset(prev, baseScale * zoom));
  }, [zoom, baseScale, constrainedOffset]);

  // ── Pointer drag pan ──────────────────────────────────────────────
  // Document-level pointermove + pointerup listeners are attached on
  // pointerdown and torn down on pointerup. This is more robust than
  // setPointerCapture + React handlers — capture can fail silently
  // when the modal is mounted via createPortal, and React's synthetic
  // events can drop pointer events past certain bubbling thresholds.
  // Document listeners fire reliably even when the cursor leaves the
  // stage, which is exactly the behavior a drag wants.
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (isBusy) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startOx = offset.x;
      const startOy = offset.y;
      const pointerId = e.pointerId;

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const next = constrainedOffset(
          { x: startOx + (ev.clientX - startX), y: startOy + (ev.clientY - startY) },
          baseScale * zoom,
        );
        setOffset(next);
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    },
    [offset.x, offset.y, baseScale, zoom, constrainedOffset, isBusy],
  );

  // Wheel zoom on desktop. We pin the zoom to cursor position so the
  // pixel under the cursor stays put as the user scrolls.
  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      if (isBusy || !stageRef.current) return;
      e.preventDefault();
      const stageRect = stageRef.current.getBoundingClientRect();
      const cx = e.clientX - (stageRect.left + stageRect.width / 2);
      const cy = e.clientY - (stageRect.top + stageRect.height / 2);
      const next = clamp(zoom * (1 - e.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM);
      // Keep the cursor stationary across the zoom change.
      const ratio = next / zoom;
      const nextOffset = constrainedOffset(
        { x: cx + (offset.x - cx) * ratio, y: cy + (offset.y - cy) * ratio },
        baseScale * next,
      );
      setZoom(next);
      setOffset(nextOffset);
    },
    [zoom, offset, baseScale, constrainedOffset, isBusy],
  );

  // ── Save: bake a round JPEG and hand it back ─────────────────────
  const handleSave = useCallback(async () => {
    if (!imgDims || isBusy) return;
    setInternalBusy(true);
    setPhase('saving');

    // Translate the on-screen offset back to source-image space so we
    // can crop a *square* region of the source that, when scaled into
    // the output size, matches what the user sees inside the circle.
    const s = baseScale * zoom;
    const sourceCircleSize = STAGE_SIZE / s; // size of the cropped square in source px
    const sourceCenterX = imgDims.w / 2 - offset.x / s;
    const sourceCenterY = imgDims.h / 2 - offset.y / s;
    const sx = sourceCenterX - sourceCircleSize / 2;
    const sy = sourceCenterY - sourceCircleSize / 2;

    const out = outputSize * PIXEL_RATIO;
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext('2d');
    if (!ctx || !imgElRef.current) {
      setInternalBusy(false);
      setPhase('open');
      return;
    }

    // White background so transparent PNGs flatten to white instead
    // of producing a black JPEG fringe.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out, out);

    // Mask to a circle so JPEGs that get re-uploaded elsewhere stay
    // round-by-design even if the rendering surface forgets the
    // border-radius. (Saves an extra hidden step downstream.)
    ctx.save();
    ctx.beginPath();
    ctx.arc(out / 2, out / 2, out / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(
      imgElRef.current,
      sx,
      sy,
      sourceCircleSize,
      sourceCircleSize,
      0,
      0,
      out,
      out,
    );
    ctx.restore();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92),
    );
    if (!blob) {
      setInternalBusy(false);
      setPhase('open');
      return;
    }

    try {
      await onSave(blob);
      // Phase 10: success ring + bounce, then close out via leave.
      setPhase('success');
      window.setTimeout(() => {
        setPhase('leave');
        window.setTimeout(onClose, 240);
      }, 600);
    } catch {
      setInternalBusy(false);
      setPhase('open');
    }
  }, [imgDims, baseScale, zoom, offset, outputSize, onSave, onClose, isBusy]);

  const handleClose = useCallback(() => {
    if (isBusy) return;
    setPhase('leave');
    window.setTimeout(onClose, 200);
  }, [isBusy, onClose]);

  // FLIP-style: if the caller passed an originRect, anchor the
  // entering/leaving stage to that rect via CSS variables. The CSS
  // uses these to compute the initial transform that morphs the
  // source avatar into the crop circle.
  const flipStyle = useMemo(() => {
    if (!originRect) return undefined;
    return {
      ['--flip-cx' as string]: `${originRect.left + originRect.width / 2}px`,
      ['--flip-cy' as string]: `${originRect.top + originRect.height / 2}px`,
      ['--flip-size' as string]: `${originRect.width}px`,
    };
  }, [originRect]);

  if (typeof document === 'undefined') return null;

  const displayedScale = baseScale * zoom;

  return createPortal(
    <div
      className={`avatar-modal-backdrop avatar-modal--${phase}`}
      // Use onPointerDown (not onClick) so iOS Safari fires reliably on
      // plain div elements. Avoids the synthesized post-dialog click
      // that iOS fires after the native file picker closes.
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (!isBusy && phase === 'open') handleClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Crop your avatar"
      style={flipStyle}
    >
      <div className="avatar-modal" onPointerDown={(e) => e.stopPropagation()}>
        <header className="avatar-modal-head">
          <h2>Crop your avatar</h2>
          <button
            className="avatar-modal-close"
            onClick={handleClose}
            disabled={isBusy}
            aria-label="Close"
          >×</button>
        </header>

        <div
          ref={stageRef}
          className="avatar-modal-stage"
          onPointerDown={onPointerDown}
          onWheel={onWheel}
          aria-label="Drag to recenter, scroll to zoom"
        >
          {/* The image sits at the stage center; offset + scale apply
              via a single transform. Older variant wrapped the image
              in a div + used relative positioning to center, which
              broke when the natural image size > stage size — the
              wrapper-percent math evaluated against the wrong box.
              Direct transform on the <img> avoids that entirely. */}
          <img
            ref={imgElRef}
            src={src}
            alt=""
            draggable={false}
            onLoad={onImgLoad}
            className="avatar-modal-img"
            style={{
              transform: `translate(-50%, -50%) translate3d(${offset.x}px, ${offset.y}px, 0) scale(${displayedScale})`,
              opacity: imgDims ? 1 : 0,
            }}
          />

          {/* Circle mask + animated stroke ring that shimmers while
              the user is interacting. */}
          <div className="avatar-modal-circle" aria-hidden="true">
            <div className="avatar-modal-circle-stroke" />
            <div className="avatar-modal-circle-glow" />
          </div>

          {/* Success ring - sweeps clockwise on save. */}
          <svg className="avatar-modal-success-ring" viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="48" pathLength={100} />
          </svg>
          {/* Success checkmark - draws after the ring completes. */}
          <svg className="avatar-modal-success-check" viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="5 13 10 18 19 7" pathLength={100} />
          </svg>
        </div>

        <div className="avatar-modal-zoom">
          <span aria-hidden="true" className="avatar-modal-zoom-icon avatar-modal-zoom-icon-min">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="11" cy="11" r="6" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
          </span>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            disabled={isBusy}
            aria-label="Zoom"
          />
          <span aria-hidden="true" className="avatar-modal-zoom-icon avatar-modal-zoom-icon-max">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="11" cy="11" r="6" /><line x1="8" y1="11" x2="14" y2="11" /><line x1="11" y1="8" x2="11" y2="14" /></svg>
          </span>
        </div>

        <footer className="avatar-modal-foot">
          <button
            className="avatar-modal-cancel"
            onClick={handleClose}
            disabled={isBusy}
          >
            Cancel
          </button>
          <button
            className={`avatar-modal-save${isBusy ? ' is-busy' : ''}`}
            onClick={handleSave}
            disabled={isBusy || !imgDims}
          >
            <span className="avatar-modal-save-label">
              {phase === 'success' ? 'Saved' : isBusy ? 'Saving' : 'Save'}
            </span>
            <span className="avatar-modal-save-spinner" aria-hidden="true" />
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

// ───────────────────────────────────────────────────────────────────
// AvatarUpload trigger - drop-in replacement for the avatar <img>
// inside UserMenu. Click the avatar → file picker → crop modal →
// upload pipeline → updated avatar. Falls back to a placeholder
// circle when the user has no avatar set.
// ───────────────────────────────────────────────────────────────────

interface AvatarUploadProps {
  userId: string | undefined;
  currentUrl?: string;
  fallbackInitial?: string;
  /** Called with the new public URL once the upload + profile patch
   *  has landed. UserMenu uses this to swap the rendered <img> src. */
  onUploaded: (url: string) => void;
  className?: string;
}

export function AvatarUpload({
  userId,
  currentUrl,
  fallbackInitial,
  onUploaded,
  className,
}: AvatarUploadProps) {
  const [pickedSrc, setPickedSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [originRect, setOriginRect] = useState<DOMRect | null>(null);
  // Drop-modal toggle. Clicking the avatar opens this; the user
  // either drops a file onto the zone or picks one through the
  // browser's file dialog. Either path funnels through processFile().
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const handleClick = useCallback(() => {
    if (!userId) return;
    if (buttonRef.current) {
      setOriginRect(buttonRef.current.getBoundingClientRect());
    }
    setPickerOpen(true);
  }, [userId]);

  // Shared file-handling pipeline used by both drag-drop and file-input
  // paths inside the drop modal. Validates → HEIC-decodes if needed →
  // creates the object URL → flips state so the crop modal renders.
  const processFile = useCallback(async (file: File) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(file.type)
      || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
    if (!ok) {
      setError('Use a JPEG, PNG, WebP, or HEIC image.');
      window.setTimeout(() => setError(null), 3000);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('That image is too large (10 MB max).');
      window.setTimeout(() => setError(null), 3000);
      return;
    }

    let blob: Blob = file;
    if (
      file.type === 'image/heic' ||
      file.type === 'image/heif' ||
      /\.(heic|heif)$/i.test(file.name)
    ) {
      try {
        const { default: heic2any } = await import('heic2any');
        const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 });
        blob = Array.isArray(out) ? out[0] : (out as Blob);
      } catch {
        setError('Couldn’t read that HEIC. Try a JPEG.');
        window.setTimeout(() => setError(null), 3000);
        return;
      }
    }

    setPickedSrc(URL.createObjectURL(blob));
    setPickerOpen(false);
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    await processFile(file);
  }, [processFile]);

  const handleSave = useCallback(
    async (cropped: Blob) => {
      if (!userId) return;
      setBusy(true);
      try {
        const { updateUserAvatar } = await import('~/services/profiles');
        const { url, error: err } = await updateUserAvatar(userId, cropped);
        if (err || !url) {
          setError(err || 'Upload failed.');
          window.setTimeout(() => setError(null), 3500);
          throw new Error(err);
        }
        // Cache-bust so the rendered <img> picks up the new file
        // even when the path collides (it shouldn't, since we
        // timestamp it, but belt-and-suspenders).
        const cacheBusted = `${url}?t=${Date.now()}`;
        onUploaded(cacheBusted);
      } finally {
        setBusy(false);
      }
    },
    [userId, onUploaded],
  );

  const handleClose = useCallback(() => {
    if (pickedSrc) URL.revokeObjectURL(pickedSrc);
    setPickedSrc(null);
    setOriginRect(null);
  }, [pickedSrc]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`avatar-upload-trigger${className ? ` ${className}` : ''}`}
        onClick={handleClick}
        aria-label="Change profile photo"
      >
        {currentUrl ? (
          <img src={currentUrl} alt="" className="avatar-upload-img" />
        ) : (
          <span className="avatar-upload-fallback">
            {fallbackInitial ? fallbackInitial.toUpperCase() : '·'}
          </span>
        )}
        <span className="avatar-upload-overlay" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        hidden
        onChange={handleFileChange}
      />
      {pickerOpen && (
        <FileDropModal
          onPick={() => fileInputRef.current?.click()}
          onFile={processFile}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {pickedSrc && (
        <AvatarCropModal
          src={pickedSrc}
          originRect={originRect}
          busy={busy}
          onSave={handleSave}
          onClose={handleClose}
        />
      )}
      {error && (
        <div className="avatar-upload-error" role="alert">{error}</div>
      )}
    </>
  );
}

// ───────────────────────────────────────────────────────────────────
// FileDropModal - the popup that sits between the avatar tap and the
// crop modal. Drag-and-drop zone in the body + "Browse files" button
// underneath. The drop zone highlights while a drag is hovering and
// the icon scales up subtly so the user knows the surface is live.
// ───────────────────────────────────────────────────────────────────

function FileDropModal({
  onPick,
  onFile,
  onClose,
}: {
  /** Open the browser's native file dialog. */
  onPick: () => void;
  /** Caller takes ownership of the dropped file (validation, decode,
   *  etc.) - same pipeline as the file-input change handler. */
  onFile: (file: File) => void | Promise<void>;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<'enter' | 'open' | 'leave'>('enter');
  const [dragOver, setDragOver] = useState(false);
  // Guard against iOS double-trigger: onPointerDown fires on touch start,
  // then click fires again after the file picker closes. Track whether
  // onPick was already called via pointerdown so onClick can skip it.
  const pointerPickedRef = useRef(false);

  useEffect(() => {
    const t = window.setTimeout(() => setPhase('open'), 16);
    return () => window.clearTimeout(t);
  }, []);

  const close = useCallback(() => {
    setPhase('leave');
    window.setTimeout(onClose, 180);
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear when leaving the drop zone itself, not when crossing
    // an interior child element boundary.
    if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void onFile(file);
    },
    [onFile],
  );

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`avatar-pick-backdrop avatar-pick--${phase}`}
      // Use onPointerDown (not onClick) so iOS Safari fires reliably on
      // plain div elements. Also avoids the synthetic post-dialog click
      // that iOS fires after the native file picker closes, which would
      // otherwise land here and dismiss the modal unexpectedly.
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Choose a profile photo"
    >
      <div className="avatar-pick" onPointerDown={(e) => e.stopPropagation()}>
        <header className="avatar-pick-head">
          <h2>Change profile photo</h2>
          <button
            className="avatar-modal-close"
            onClick={close}
            aria-label="Close"
          >×</button>
        </header>

        <div
          className={`avatar-pick-drop${dragOver ? ' is-over' : ''}`}
          onDragOver={onDragOver}
          onDragEnter={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onPointerDown={onPick}
          onClick={onPick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onPick();
            }
          }}
        >
          {/* Animated dashed ring + cloud-up glyph. The ring rotates
              very slowly when idle and snaps tight on dragOver. */}
          <svg className="avatar-pick-ring" viewBox="0 0 200 200" aria-hidden="true">
            <circle cx="100" cy="100" r="92" />
          </svg>
          <div className="avatar-pick-icon" aria-hidden="true">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <div className="avatar-pick-headline">
            {dragOver ? 'Drop to use it' : 'Drag a photo here'}
          </div>
          <div className="avatar-pick-sub">
            JPEG, PNG, WebP, or HEIC · up to 10 MB
          </div>
        </div>

        <div className="avatar-pick-or" aria-hidden="true">
          <span>or</span>
        </div>

        <button
          className="avatar-pick-browse"
          onPointerDown={() => { pointerPickedRef.current = true; onPick(); }}
          onClick={() => { if (pointerPickedRef.current) { pointerPickedRef.current = false; return; } onPick(); }}
          type="button"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span>Browse files</span>
        </button>
      </div>
    </div>,
    document.body,
  );
}
