// Mosaic Reveal — a full-bleed wall of product tiles flips alive in a
// diagonal wave (3D rotateY), holds, then the whole wall zooms forward
// and dissolves to hand off to the feed. CSS-only: a grid of cells, each
// with a stagger delay derived from its diagonal index.

import { useMemo, type CSSProperties } from 'react';
import type { SplashVariantProps } from '../types';

const COLS = 6;
const ROWS = 8;

export default function MosaicReveal({ images, phase, replayKey }: SplashVariantProps) {
  const cells = useMemo(() => {
    const total = COLS * ROWS;
    return Array.from({ length: total }, (_, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const diag = col + row;                 // wave front
      const url = images.length ? images[(col * 3 + row * 5 + i) % images.length] : '';
      return { url, diag };
    });
  }, [images]);

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
            {c.url && <img src={c.url} alt="" loading="eager" decoding="async" draggable={false} />}
          </div>
        ))}
      </div>
      <div className="sv-mosaic-center" />
      <div className="sv-vignette" />
    </div>
  );
}
