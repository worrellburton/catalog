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
      {...rest}
    />
  );
}
