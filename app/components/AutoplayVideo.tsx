/**
 * <video> element that auto-pauses when scrolled off-screen via the
 * shared useInViewport pool. The browser will happily keep decoding
 * a hidden looping video forever — on pages with many tiles (MyLooks,
 * /admin/user/<name> generated grid, /c/<handle>) that adds up to real
 * CPU + battery cost on mobile.
 *
 * Pass any props a normal <video> accepts; this wrapper just owns the
 * ref + the play/pause lifecycle.
 */

import { useEffect, useRef } from 'react';
import { useInViewport } from '~/hooks/useInViewport';

interface Props extends React.VideoHTMLAttributes<HTMLVideoElement> {
  /** Earlier than the page-wide default — we want the video to be
   *  ready by the time the tile actually enters the viewport. */
  rootMargin?: string;
}

export default function AutoplayVideo({ rootMargin = '50% 0%', ...rest }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const visible = useInViewport(ref, rootMargin);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (visible) {
      // play() can reject if the element was removed; swallow it so a
      // stale tile during navigation doesn't surface an UnhandledRejection.
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [visible]);

  return (
    <video
      ref={ref}
      // We control play() via the visibility hook — autoPlay would race
      // against the initial mount and start playing off-screen tiles
      // for a beat before we get to pause them.
      muted
      playsInline
      loop
      preload="metadata"
      // Match every other <video> in the app (LookCard / TrailVideoHost /
      // product media all set this). Two reasons it matters here:
      //   1. captureVideoFrame() draws this element to a canvas for the
      //      tap→overlay poster handoff; without CORS the canvas taints and
      //      the snapshot silently fails (falls back to a product image).
      //   2. The detail overlay re-requests the SAME url WITH crossOrigin;
      //      if the tile loaded it WITHOUT, the two cache modes collide on
      //      WebKit and the overlay video errors out. Loading both in the
      //      same (cors) mode keeps playback unbroken across the handoff.
      // Safe because every video host we serve (fal.media, Supabase storage)
      // returns `Access-Control-Allow-Origin: *`.
      crossOrigin="anonymous"
      {...rest}
    />
  );
}
