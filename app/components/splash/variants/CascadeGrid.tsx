// Cascade to Grid — products tumble in from scattered 3D space, swirl
// past center, then settle onto a feed-shaped grid. Pure CSS transforms
// on a preserve-3d stage; nothing runs per-frame in JS.

import { useMemo, type CSSProperties } from 'react';
import { seeded } from '../useSplashImages';
import type { SplashVariantProps } from '../types';

const GRID_COLS = 6;

interface Placement {
  url: string;
  sx: number; sy: number; sz: number; srot: number;
  gx: number; gy: number; delay: number;
}

function place(urls: string[]): Placement[] {
  const rows = Math.max(1, Math.ceil(urls.length / GRID_COLS));
  return urls.map((url, i) => {
    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS);
    const gx = ((col + 0.5) / GRID_COLS) * 100;
    const gy = ((row + 0.5) / rows) * 100;
    const ang = seeded(i, 1) * Math.PI * 2;
    const dist = 60 + seeded(i, 2) * 60;
    const sx = 50 + Math.cos(ang) * dist;
    const sy = 50 + Math.sin(ang) * dist;
    const sz = -400 - seeded(i, 3) * 700;
    const srot = (seeded(i, 4) - 0.5) * 160;
    const delay = seeded(i, 5) * 280;
    return { url, sx, sy, sz, srot, gx, gy, delay };
  });
}

export default function CascadeGrid({ images, replayKey }: SplashVariantProps) {
  const tiles = useMemo(() => place(images), [images]);
  return (
    <div className="sv-cascade-stage">
      {tiles.map((t, i) => (
        <div
          key={`${i}-${replayKey}`}
          className="sv-cascade-tile"
          style={{
            ['--sx' as string]: `${t.sx}%`,
            ['--sy' as string]: `${t.sy}%`,
            ['--sz' as string]: `${t.sz}px`,
            ['--srot' as string]: `${t.srot}deg`,
            ['--gx' as string]: `${t.gx}%`,
            ['--gy' as string]: `${t.gy}%`,
            animationDelay: `${t.delay}ms`,
          } as CSSProperties}
        >
          <img src={t.url} alt="" loading="eager" decoding="async" draggable={false} />
        </div>
      ))}
      <div className="sv-vignette" />
    </div>
  );
}
