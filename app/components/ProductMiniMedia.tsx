// Poster-first media for the product list inside LookOverlay.
//
// Strategy:
//   1. Paint the poster (product image or video poster) immediately —
//      no waiting, no loading spinner.
//   2. Once the poster has loaded AND a video URL is present AND the row
//      is near the viewport AND a decoder slot is free, mount the <video>
//      element with preload="auto". Browser begins streaming the muted
//      clip behind the poster.
//   3. When the video reports canplay, fade it on top of the poster.
//      The poster stays in the DOM so the box is never empty if the
//      video stalls.
//   4. When the row scrolls away the <video> unmounts and frees its slot,
//      so a look with 6–8 product clips never holds 6–8 decoders on top
//      of the hero and rails (that stacked straight onto the iOS
//      simultaneous-decoder ceiling and stalled the foreground).
//
// Framing: poster AND video both use object-fit: cover / center (the
// thumb box is 3:4, matching the poster's native aspect, so cover fills
// it edge-to-edge with no crop). The two layers MUST share the same
// framing — a cover poster crossfading to a contain video jumped/glitched
// on the swap. The CSS is co-located so the component is drop-in for any
// future surface that wants the same poster-then-video pattern.

// imports
import { useEffect, useRef, useState } from 'react';
import { posterRendition } from '~/utils/poster-prefetch';
import { useInViewport } from '~/hooks/useInViewport';
import { isMobileViewport } from '~/services/video-loading';

// types
interface Props {
  /** Static poster — product photo (primary_image_url) or the video's
   *  own thumbnail. Painted immediately as the base layer. */
  posterSrc: string | null | undefined;
  /** Optional video URL. When present + posterLoaded + near the viewport
   *  + a slot is free, the <video> element mounts and crossfades on top
   *  of the poster on canplay. */
  videoSrc?: string | null;
  alt?: string;
  /** Falls back to a colored block when no poster is available. */
  fallbackColor?: string;
}

// constants
/** How many product-row clips may decode at once, app-wide. These sit
 *  beside a playing hero (and under it, rail tiles), so the budget is
 *  deliberately small. */
const MAX_ACTIVE_DESKTOP = 4;
const MAX_ACTIVE_MOBILE = 2;
/** Mount when the row is within a quarter-screen of the viewport. */
const NEAR_MARGIN = '25% 0%';

let activeClips = 0;

// helpers
function tryAcquireClipSlot(): boolean {
  const max = isMobileViewport() ? MAX_ACTIVE_MOBILE : MAX_ACTIVE_DESKTOP;
  if (activeClips >= max) return false;
  activeClips++;
  return true;
}

function releaseClipSlot(): void {
  activeClips = Math.max(0, activeClips - 1);
}

// main logic
export default function ProductMiniMedia({ posterSrc, videoSrc, alt = '', fallbackColor }: Props) {
  const [posterLoaded, setPosterLoaded] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [hasSlot, setHasSlot] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const heldRef = useRef(false);
  const nearViewport = useInViewport(imgRef, NEAR_MARGIN);

  // Acquire a decoder slot only while the row is near the viewport (and
  // the poster has painted, so the poster download always wins the race);
  // give it back the moment the row scrolls away.
  useEffect(() => {
    const want = nearViewport && posterLoaded && !!videoSrc;
    if (want && !heldRef.current) {
      if (tryAcquireClipSlot()) {
        heldRef.current = true;
        setHasSlot(true);
      }
    } else if (!want && heldRef.current) {
      releaseClipSlot();
      heldRef.current = false;
      setHasSlot(false);
      setVideoReady(false);
    }
  }, [nearViewport, posterLoaded, videoSrc]);

  useEffect(() => () => {
    if (heldRef.current) {
      releaseClipSlot();
      heldRef.current = false;
    }
  }, []);

  const shouldMountVideo = !!videoSrc && hasSlot;

  useEffect(() => {
    if (!shouldMountVideo) return;
    const v = videoRef.current;
    if (!v) return;
    const onCanPlay = () => setVideoReady(true);
    v.addEventListener('canplay', onCanPlay, { once: true });
    return () => v.removeEventListener('canplay', onCanPlay);
  }, [shouldMountVideo]);

  if (!posterSrc) {
    return (
      <div
        className="product-thumb-placeholder"
        style={{ background: fallbackColor || 'rgba(255,255,255,0.06)', opacity: 0.5 }}
      />
    );
  }

  // SHARED rendition (utils/poster-prefetch): this exact URL is what the
  // feed cards and the product hero request, so the row thumb both paints
  // from any earlier sighting AND pre-seeds the hero for the tap-through —
  // a private 480/q80/webp variant here meant the hero cache-missed and
  // opened black.
  const resolvedPoster = posterRendition(posterSrc) ?? '';

  return (
    <>
      <img
        ref={imgRef}
        src={resolvedPoster}
        alt={alt}
        className="product-thumb-img"
        loading="lazy"
        decoding="async"
        onLoad={() => setPosterLoaded(true)}
        onError={() => setPosterLoaded(true)}
        style={{
          position: 'absolute',
          inset: 0,
          opacity: videoReady ? 0 : 1,
          transition: 'opacity 240ms ease',
        }}
      />
      {shouldMountVideo && (
        <video
          ref={videoRef}
          src={videoSrc || undefined}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          className="product-thumb-video"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            // object-fit is intentionally NOT set inline: it's driven by the
            // surface CSS so the video shares the SAME framing as the poster
            // <img> in that surface (cover in the LookOverlay list, contain in
            // the inline feed detail). An inline value would diverge from the
            // poster and make the crossfade jump.
            opacity: videoReady ? 1 : 0,
            transition: 'opacity 240ms ease',
          }}
        />
      )}
    </>
  );
}
