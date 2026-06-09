// Poster-first, viewport-gated product tile for the creator profile Shop tab.
//
// Why this exists: the Shop tab used to render each product as a STATIC image,
// so products never played. This mirrors the feed's "poster paints instantly,
// video crossfades in" feel — but with a plain progressive MP4 element:
//   • MP4 decodes from the first bytes in a single request → instant first
//     frame on every browser (no hls.js, no manifest→segment handshake). The
//     creator's LOOKS already play the HLS ladder via TrailVideoHost; product
//     tiles favour the universally-instant MP4 the product already carries.
//   • The <video> is gated to the viewport (useInViewport) so a large Shop
//     grid never mounts dozens of decoders at once — only on/near-screen tiles
//     buffer; the rest stay on their poster until they approach.
import { useEffect, useRef, useState } from 'react';
import { useInViewport } from '~/hooks/useInViewport';
import { withTransform } from '~/utils/supabase-image';
import { prefetchVideoBytes } from '~/services/video-loading';
import type { Product } from '~/data/looks';

interface CreatorProductTileProps {
  product: Product;
  onClick: () => void;
}

export default function CreatorProductTile({ product, onClick }: CreatorProductTileProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Mount the video ~1.5 screens before the tile scrolls into view so it's
  // already buffering by the time it's on-screen; it unmounts when far away,
  // which bounds the number of live decoders on a long Shop grid.
  const inBand = useInViewport(ref, '150% 0%');
  // Warm the MP4 into the HTTP cache ~1 screen EARLIER than we mount the
  // <video>, so by the time it mounts the bytes are a cache hit and the first
  // frame paints near-instantly instead of cold-loading (the lag fix). Same
  // low-priority byte-warm the feed uses; bounded by its own concurrency cap.
  const inWarmBand = useInViewport(ref, '250% 0%');
  const [posterLoaded, setPosterLoaded] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Poster = the video's frame-0 (primary_video_poster_url, carried as
  // thumbnail_url) so the poster→video handoff is seamless; falls back to the
  // product image. Both the poster <img> and the <video> are object-fit:cover
  // via .cpf-media, so they fill the tile identically (no jump on crossfade).
  const rawPoster = product.thumbnail_url || product.image || '';
  const poster = withTransform(rawPoster, { width: 540, quality: 72 }) || rawPoster;
  const videoSrc = product.video_url || '';
  const showVideo = inBand && !!videoSrc && posterLoaded;

  // Byte-warm the clip before it mounts so the <video> hits a warm cache.
  useEffect(() => {
    if (inWarmBand && videoSrc) prefetchVideoBytes(videoSrc);
  }, [inWarmBand, videoSrc]);

  useEffect(() => {
    if (!showVideo) { setVideoReady(false); return; }
    const v = videoRef.current;
    if (!v) return;
    const onCanPlay = () => setVideoReady(true);
    v.addEventListener('canplay', onCanPlay, { once: true });
    void v.play?.().catch(() => { /* autoplay policy — retries on next mount */ });
    return () => v.removeEventListener('canplay', onCanPlay);
  }, [showVideo, videoSrc]);

  return (
    <div ref={ref} className="look-card creator-product-feed" onClick={onClick}>
      {poster ? (
        <img
          className="cpf-media"
          src={poster}
          alt={product.name}
          loading="lazy"
          decoding="async"
          onLoad={() => setPosterLoaded(true)}
          onError={() => setPosterLoaded(true)}
          style={{ opacity: videoReady ? 0 : 1, transition: 'opacity 240ms ease' }}
        />
      ) : (
        <div className="cpf-media cpf-media--blank" />
      )}
      {showVideo && (
        <video
          ref={videoRef}
          className="cpf-media"
          src={videoSrc}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          style={{ opacity: videoReady ? 1 : 0, transition: 'opacity 240ms ease' }}
        />
      )}
      <div className="cpf-gradient" />
      <div className="cpf-info">
        {product.brand && <span className="cpf-brand">{product.brand}</span>}
        <span className="cpf-name">{product.name}</span>
        {product.price && <span className="cpf-price">{product.price}</span>}
      </div>
    </div>
  );
}
