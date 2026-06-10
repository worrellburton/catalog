// Flag-gated diagnostic for the iOS-only creator-grid "small thumbnail of the
// media in the corner" artifact seen during a HELD (un-released) touch-scroll.
//
// It is a NO-OP unless explicitly enabled, so it is safe to ship to dev/prod.
//
// ── How to use on a device / simulator ──────────────────────────────────
//   1. In the webview/Safari console (or before load):
//        localStorage.setItem('catalog:scrolldbg', '1')
//      then reload.
//   2. Open a creator catalog, drag the grid up/down WITHOUT releasing, and do
//      the back-and-forth that reproduces the thumbnail.
//   3. Connect Safari Web Inspector to the device/sim and either:
//        • watch the console for `[creatorscroll] MISMATCH …` lines (logged the
//          moment a tile's media box diverges from the tile box), or
//        • call  window.__creatorScrollDump()  to print a summary, or
//        • read  window.__creatorScrollLog     (raw ring buffer of frames).
//
// ── What it answers ──────────────────────────────────────────────────────
// The corner-thumbnail could be either:
//   (a) a JS-OBSERVABLE layout divergence — the media element's
//       getBoundingClientRect actually shrinks / anchors to a corner
//       mid-gesture (→ a layout/containing-block fix), or
//   (b) a pure COMPOSITOR paint artifact — the boxes stay correct (3:4, full
//       size) and only the painted pixels are wrong (→ a compositor/layer fix;
//       JS can't see it, so MISMATCH never fires even while it's visible).
// Which one fires tells us where the real fix has to live.

type MediaSample = {
  /** Index of the tile within the sampled set. */
  i: number;
  kind: 'poster' | 'video';
  /** Rendered media box size, px. */
  w: number;
  h: number;
  /** Offset of the media box from the tile's top-left, px. A corner thumbnail
   *  shows up as a small w/h anchored at ~0,0. */
  dx: number;
  dy: number;
  tileW: number;
  tileH: number;
  /** Media box differs from the tile box by more than 3px in either axis. */
  mismatch: boolean;
  /** Intrinsic media size (video frame / image natural size). */
  natW: number;
  natH: number;
  readyState?: number;
  cssPosition: string;
  cssTransform: string;
};

type FrameSample = {
  /** ms since instrumentation started. */
  t: number;
  phase: string;
  scrollTop: number;
  mismatches: number;
  media: MediaSample[];
};

const RING_MAX = 1200;

export function isCreatorScrollDebugOn(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('catalog:scrolldbg') === '1';
  } catch {
    return false;
  }
}

/**
 * Attach the diagnostic to a creator-page scroll container. Returns a cleanup
 * function. No-op (returns a no-op cleanup) unless the `catalog:scrolldbg` flag
 * is set, so callers can wire it unconditionally.
 */
export function startCreatorScrollDebug(scroller: HTMLElement): () => void {
  if (typeof window === 'undefined' || !isCreatorScrollDebugOn()) return () => {};

  const w = window as unknown as {
    __creatorScrollLog?: FrameSample[];
    __creatorScrollDump?: () => unknown;
  };
  const ring: FrameSample[] = w.__creatorScrollLog || (w.__creatorScrollLog = []);
  w.__creatorScrollDump = () => {
    const withMismatch = ring.filter((f) => f.mismatches > 0);
    // eslint-disable-next-line no-console
    console.log(
      `[creatorscroll] ${ring.length} frames captured, ${withMismatch.length} with a media/tile box MISMATCH`,
    );
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(withMismatch.slice(-40), null, 2));
    return { frames: ring.length, mismatchFrames: withMismatch.length, lastMismatches: withMismatch.slice(-40) };
  };

  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  const t0 = now();
  // eslint-disable-next-line no-console
  console.log('[creatorscroll] enabled', {
    ua: navigator.userAgent,
    vw: window.innerWidth,
    vh: window.innerHeight,
    dpr: window.devicePixelRatio,
    scrollerClass: scroller.className,
  });

  const measure = (phase: string) => {
    const sRect = scroller.getBoundingClientRect();
    const tiles = Array.from(
      scroller.querySelectorAll<HTMLElement>('.creator-grid .look-card'),
    ).slice(0, 10);
    const media: MediaSample[] = [];

    tiles.forEach((tile, i) => {
      const tr = tile.getBoundingClientRect();
      // Skip tiles well outside the scroller viewport.
      if (tr.bottom < sRect.top - 80 || tr.top > sRect.bottom + 80) return;

      const collect = (el: Element | null, kind: 'poster' | 'video') => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el as HTMLElement);
        const mismatch = Math.abs(r.width - tr.width) > 3 || Math.abs(r.height - tr.height) > 3;
        const natW =
          kind === 'video' ? (el as HTMLVideoElement).videoWidth : (el as HTMLImageElement).naturalWidth || 0;
        const natH =
          kind === 'video' ? (el as HTMLVideoElement).videoHeight : (el as HTMLImageElement).naturalHeight || 0;
        media.push({
          i,
          kind,
          w: Math.round(r.width),
          h: Math.round(r.height),
          dx: Math.round(r.left - tr.left),
          dy: Math.round(r.top - tr.top),
          tileW: Math.round(tr.width),
          tileH: Math.round(tr.height),
          mismatch,
          natW,
          natH,
          readyState: kind === 'video' ? (el as HTMLVideoElement).readyState : undefined,
          cssPosition: cs.position,
          cssTransform: cs.transform === 'none' ? 'none' : cs.transform.slice(0, 28),
        });
      };

      collect(tile.querySelector('.card-poster'), 'poster');
      collect(tile.querySelector('video'), 'video');
    });

    const mismatches = media.filter((m) => m.mismatch).length;
    const frame: FrameSample = {
      t: Math.round(now() - t0),
      phase,
      scrollTop: Math.round(scroller.scrollTop),
      mismatches,
      media,
    };
    ring.push(frame);
    if (ring.length > RING_MAX) ring.shift();

    if (mismatches > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        '[creatorscroll] MISMATCH',
        frame.phase,
        'scrollTop',
        frame.scrollTop,
        frame.media
          .filter((m) => m.mismatch)
          .map((m) => `${m.kind}#${m.i} ${m.w}x${m.h} @${m.dx},${m.dy} (tile ${m.tileW}x${m.tileH}, pos:${m.cssPosition})`),
      );
    }
  };

  let raf = 0;
  let dragging = false;
  const onTouchStart = () => {
    dragging = true;
    measure('touchstart');
  };
  const onTouchMove = () => {
    if (!dragging || raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      measure('touchmove');
    });
  };
  const onTouchEnd = () => {
    measure('touchend');
    dragging = false;
  };
  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      measure(dragging ? 'scroll(drag)' : 'scroll');
    });
  };

  scroller.addEventListener('touchstart', onTouchStart, { passive: true });
  scroller.addEventListener('touchmove', onTouchMove, { passive: true });
  scroller.addEventListener('touchend', onTouchEnd, { passive: true });
  scroller.addEventListener('touchcancel', onTouchEnd, { passive: true });
  scroller.addEventListener('scroll', onScroll, { passive: true });

  return () => {
    if (raf) cancelAnimationFrame(raf);
    scroller.removeEventListener('touchstart', onTouchStart);
    scroller.removeEventListener('touchmove', onTouchMove);
    scroller.removeEventListener('touchend', onTouchEnd);
    scroller.removeEventListener('touchcancel', onTouchEnd);
    scroller.removeEventListener('scroll', onScroll);
  };
}
