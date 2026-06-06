// Poster-first media for the product list inside LookOverlay.
//
// Strategy:
//   1. Paint the poster (product image or video poster) immediately —
//      no waiting, no loading spinner.
//   2. Once the poster has loaded AND a video URL is present, mount
//      the <video> element with preload="auto". Browser begins
//      streaming the muted clip behind the poster.
//   3. When the video reports canplay, fade it on top of the poster.
//      The poster stays in the DOM so the box is never empty if the
//      video stalls.
//
// Framing uses object-fit: contain instead of cover so the entire
// product (sweater silhouette, pant leg, full shoe) is visible inside
// the 52×52 thumb — the previous cover crop showed a tight detail
// shot that read as a square of fabric. The CSS is co-located so the
// component is drop-in for any future surface that wants the same
// poster-then-video pattern at this size.

import { useEffect, useRef, useState } from 'react';
import { withTransform } from '~/utils/supabase-image';

interface Props {
  /** Static poster — product photo (primary_image_url) or the video's
   *  own thumbnail. Painted immediately as the base layer. */
  posterSrc: string | null | undefined;
  /** Optional video URL. When present + posterLoaded, the <video>
   *  element mounts and crossfades on top of the poster on canplay. */
  videoSrc?: string | null;
  alt?: string;
  /** Falls back to a colored block when no poster is available. */
  fallbackColor?: string;
}

export default function ProductMiniMedia({ posterSrc, videoSrc, alt = '', fallbackColor }: Props) {
  const [posterLoaded, setPosterLoaded] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Defer mounting the <video> until the poster has actually painted —
  // otherwise the browser kicks both downloads at the same time and the
  // poster path doesn't beat the video the way it should.
  const shouldMountVideo = !!videoSrc && posterLoaded;

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

  // Bumped to 480 px wide @ q=80 so the poster carries enough detail
  // to read at the 72 px display box on retina screens (288 px effective
  // resolution at 4× DPR) without falling back to the source URL's
  // possibly-huge dimensions. The user asked for "full resolution"
  // poster — 480 px is the sweet spot where every screen renders crisp
  // without burning bandwidth on a 2000 px-wide product hero.
  const resolvedPoster = withTransform(posterSrc, { width: 480, quality: 80, format: 'webp' }) ?? '';

  return (
    <>
      <img
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
            objectFit: 'contain',
            opacity: videoReady ? 1 : 0,
            transition: 'opacity 240ms ease',
          }}
        />
      )}
    </>
  );
}
