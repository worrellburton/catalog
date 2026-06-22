// LazyThumb — admin Data thumbnail tile. Lazily snapshots the first frame of a
// product/look video (IntersectionObserver-gated) and shows it as a poster, so
// the Data tables don't mount dozens of <video> elements at once. Extracted
// from app/routes/admin/data.tsx (god-file split #8); self-contained.

import { useEffect, useRef, useState } from 'react';

export function LazyThumb({ url, thumbnail, stillOnly }: { url: string; thumbnail?: string | null; stillOnly?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [inView, setInView] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  // Client-side first-frame extraction: when there's no admin-supplied
  // thumbnail, we draw the first decoded frame of the video to a
  // canvas, hold the resulting data URL as the poster, and the
  // browser paints it instantly on every subsequent render. The
  // video element fades in over it once `canplay` fires.
  const [extractedPoster, setExtractedPoster] = useState<string | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: '1200px 0px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  // First-frame extraction. Was gated on `inView` so off-screen rows
  // didn't kick the snapshot — but the practical effect was a wall of
  // black squares: rows that ARE in view still need ~1s to seek +
  // snapshot, so the user sees flat #111 the whole time. Lift the
  // gate so every row's snapshot kicks immediately on mount; the
  // downscaled JPEG paints as soon as the seek lands, which is the
  // "really low-resolution poster" the admin asked for. The video
  // element still gates on inView, so we're not hammering the
  // network with full playback streams for off-screen rows — the
  // snapshot fetch is metadata-only + a single decoded frame, which
  // the browser caches under the same URL the video element will
  // request when the row scrolls in.
  useEffect(() => {
    if (thumbnail || extractedPoster) return;
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = url;
    let cancelled = false;
    const onLoaded = () => {
      if (cancelled) return;
      try { v.currentTime = Math.min(0.05, (v.duration || 1) / 2); } catch { /* */ }
    };
    const onSeeked = () => {
      if (cancelled) return;
      try {
        // Downscale to a thumbnail-sized canvas so the resulting data
        // URL is ~3-6 KB instead of ~40-80 KB. The admin row's <img>
        // is rendered at <100 px wide so 120 px width is plenty —
        // anything more is bytes the browser can't show. JPEG q=0.5
        // is fine for a placeholder; q=0.85+ for the final video.
        const srcW = v.videoWidth || 360;
        const srcH = v.videoHeight || 480;
        const targetW = Math.min(120, srcW);
        const targetH = Math.round(srcH * (targetW / srcW));
        const c = document.createElement('canvas');
        c.width = targetW;
        c.height = targetH;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(v, 0, 0, targetW, targetH);
        setExtractedPoster(c.toDataURL('image/jpeg', 0.5));
      } catch { /* CORS or cross-origin canvas taint — silent fallback */ }
    };
    v.addEventListener('loadeddata', onLoaded);
    v.addEventListener('seeked', onSeeked);
    return () => {
      cancelled = true;
      v.removeEventListener('loadeddata', onLoaded);
      v.removeEventListener('seeked', onSeeked);
      v.src = '';
    };
  }, [url, thumbnail, extractedPoster]);

  const posterSrc = thumbnail || extractedPoster;

  return (
    <div
      ref={ref}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        // Subtle shimmer instead of flat #111 so the snapshot-loading
        // window doesn't read as a dead black square. Once the poster
        // (or video) lands, it covers this entirely.
        background: 'linear-gradient(135deg, #1a1a1a 0%, #232323 50%, #1a1a1a 100%)',
        backgroundSize: '200% 200%',
        animation: posterSrc ? 'none' : 'admin-thumb-shimmer 1.6s ease-in-out infinite',
      }}
    >
      {posterSrc && (
        <img
          src={posterSrc}
          alt=""
          loading="lazy"
          decoding="async"
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover', display: 'block',
            opacity: videoReady ? 0 : 1,
            transition: 'opacity 200ms ease',
          }}
        />
      )}
      {inView && !stillOnly && (
        <>
          <video
            ref={videoRef}
            src={url}
            poster={posterSrc || undefined}
            autoPlay muted loop playsInline preload="auto"
            onCanPlay={() => setVideoReady(true)}
            style={{
              position: 'relative', zIndex: 1,
              opacity: videoReady ? 1 : 0,
              transition: 'opacity 200ms ease',
            }}
          />
          <div className="admin-look-preview">
            <video src={url} poster={posterSrc || undefined} autoPlay muted loop playsInline />
          </div>
        </>
      )}
    </div>
  );
}
