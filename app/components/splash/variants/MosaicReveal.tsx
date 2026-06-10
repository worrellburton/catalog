// Mosaic Reveal — a full-bleed wall of product tiles flips alive in a
// diagonal wave (3D rotateY), holds, then the whole wall zooms forward
// and dissolves to hand off to the feed. CSS-only: a grid of cells, each
// with a stagger delay derived from its diagonal index.

import { useMemo, type CSSProperties } from 'react';
import type { SplashVariantProps } from '../types';

const COLS = 6;
const ROWS = 8;

export default function MosaicReveal({ images, videos = [], phase, replayKey }: SplashVariantProps) {
  const cells = useMemo(() => {
    const total = COLS * ROWS;
    // Place the handful of clips on interior cells (away from the very
    // edges) so the live tiles read as the focal point of the wall.
    const videoCells = new Map<number, (typeof videos)[number]>();
    if (videos.length) {
      const slots = [16, 21, 26, 27, 32, 19].slice(0, videos.length);
      slots.forEach((slot, k) => videoCells.set(slot, videos[k]));
    }
    return Array.from({ length: total }, (_, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const diag = col + row;                 // wave front
      const url = images.length ? images[(col * 3 + row * 5 + i) % images.length] : '';
      return { url, diag, video: videoCells.get(i) ?? null };
    });
  }, [images, videos]);

  return (
    <div
      className={`sv-mosaic-scene ${phase !== 'assemble' ? 'sv-mosaic-open' : ''}`}
      style={{
        ['--cols' as string]: COLS,
        ['--rows' as string]: ROWS,
      } as CSSProperties}
    >
      <div className="sv-mosaic-grid">
        {cells.map((c, i) => (
          <div
            key={`${i}-${replayKey}`}
            className="sv-mosaic-cell"
            style={{ animationDelay: `${c.diag * 55}ms` } as CSSProperties}
          >
            {c.video ? (
              <video
                src={c.video.src}
                poster={c.video.poster || c.url}
                muted loop autoPlay playsInline preload="auto"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : c.url ? (
              <img src={c.url} alt="" loading="eager" decoding="async" draggable={false} />
            ) : null}
          </div>
        ))}
      </div>
      <div className="sv-mosaic-center" />
      <div className="sv-vignette" />
    </div>
  );
}
