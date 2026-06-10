// Director-driven product tile for the creator profile Shop tab.
//
// Why this exists: the Shop tab used to render each product as a STATIC image,
// then briefly as its own standalone <video> per tile — which cold-decoded one
// MP4 per on-screen tile and janked a multi-column grid (each tile started
// "one by one"). It now shares the VideoPlaybackDirector with the Looks tab:
//   • Bounded, proximity-ranked pool — only the few nearest tiles hold a live
//     <video>; the rest stay on their poster. No decoder explosion on a long
//     grid, no matter how many products the creator has.
//   • Prebuffer ahead — the director warms the nearest upcoming tiles so they
//     play near-instantly when they scroll in, instead of cold-starting.
//   • Same scope as the catalog (slotId prefixed `creator:<name>:`), so while
//     the profile is open these tiles own playback and the home feed behind
//     stays paused (see CreatorPage's director.pushScope).
import { useEffect, useRef, useCallback } from 'react';
import { useInViewport } from '~/hooks/useInViewport';
import { withTransform } from '~/utils/supabase-image';
import { prefetchVideoBytes } from '~/services/video-loading';
import { useDirectorSlot } from '~/hooks/useDirectorSlot';
import type { Product } from '~/data/looks';

interface CreatorProductTileProps {
  product: Product;
  onClick: () => void;
  /** Director slot id. MUST be prefixed with the creator page's director scope
   *  (`creator:<name>:…`) so this tile plays while the catalog scope is active. */
  slotId: string;
}

export default function CreatorProductTile({ product, onClick, slotId }: CreatorProductTileProps) {
  // Poster = the video's frame-0 (primary_video_poster_url, carried as
  // thumbnail_url) so the poster→video handoff is seamless; falls back to the
  // product image. The director reveals the pooled <video> (z-index 2) over
  // this poster (z-index 1) once it has frames — no black flash.
  const rawPoster = product.thumbnail_url || product.image || '';
  const poster = withTransform(rawPoster, { width: 540, quality: 72 }) || rawPoster;
  const videoSrc = product.video_url || '';

  // Wire into the director. It appends a pooled <video> into containerRef when
  // this tile is among the nearest-to-viewport (top-K) and plays it. Passing a
  // null url (no product video) keeps the tile poster-only — never registered.
  const { containerRef } = useDirectorSlot(slotId, videoSrc || null, poster || undefined);

  // Belt-and-braces byte-warm ~1.5 screens ahead (mirrors CreativeCardV2). The
  // director already prebuffers the nearest tiles; this covers a fast scroll
  // that blows past the prebuffer band before the director can prearm. Bounded
  // by prefetchVideoBytes' own concurrency cap + save-data/slow gating.
  const warmRef = useRef<HTMLDivElement | null>(null);
  const setRefs = useCallback((node: HTMLDivElement | null) => {
    warmRef.current = node;
    containerRef(node);
  }, [containerRef]);
  const inWarmBand = useInViewport(warmRef, '150% 0%');
  useEffect(() => {
    if (inWarmBand && videoSrc) prefetchVideoBytes(videoSrc);
  }, [inWarmBand, videoSrc]);

  return (
    <div ref={setRefs} className="look-card creator-product-feed" onClick={onClick}>
      {poster ? (
        <img
          className="cpf-media"
          src={poster}
          alt={product.name}
          loading="lazy"
          decoding="async"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <div className="cpf-media cpf-media--blank" />
      )}
      {/* Director appends the pooled <video> here (z-index 2), above the
          poster (z-index 1). The gradient + info sit above both. */}
      <div className="cpf-gradient" />
      <div className="cpf-info">
        {product.brand && <span className="cpf-brand">{product.brand}</span>}
        <span className="cpf-name">{product.name}</span>
        {product.price && <span className="cpf-price">{product.price}</span>}
      </div>
    </div>
  );
}
