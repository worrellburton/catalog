// Spiral Vortex — products ride an Archimedean spiral inward through a
// 3D funnel, rotating and shrinking toward the center where the wordmark
// resolves. CSS-only: each tile animates start→center along its own arm.

import { useMemo, type CSSProperties } from 'react';
import { seeded } from '../useSplashImages';
import type { SplashVariantProps } from '../types';

interface Arm {
  url: string;
  // start point on the outer spiral (percent from center)
  sx: number; sy: number; sz: number;
  spin: number;   // total degrees of inward rotation
  delay: number;
}

function buildArms(urls: string[]): Arm[] {
  const n = urls.length;
  const turns = 2.4;
  return urls.map((url, i) => {
    const t = i / Math.max(1, n);
    const angle = t * turns * Math.PI * 2;
    const radius = 38 + t * 34;               // outer arm
    const sx = 50 + Math.cos(angle) * radius;
    const sy = 50 + Math.sin(angle) * radius * 0.7; // slight ellipse
    const sz = -200 - seeded(i, 7) * 500;
    const spin = 220 + t * 180;
    const delay = t * 360;
    return { url, sx, sy, sz, spin, delay };
  });
}

export default function SpiralVortex({ images, replayKey }: SplashVariantProps) {
  const arms = useMemo(() => buildArms(images), [images]);
  return (
    <div className="sv-vortex-scene">
      {arms.map((a, i) => (
        <div
          key={`${i}-${replayKey}`}
          className="sv-vortex-tile"
          style={{
            ['--sx' as string]: `${a.sx}%`,
            ['--sy' as string]: `${a.sy}%`,
            ['--sz' as string]: `${a.sz}px`,
            ['--spin' as string]: `${a.spin}deg`,
            animationDelay: `${a.delay}ms`,
          } as CSSProperties}
        >
          <img src={a.url} alt="" loading="eager" decoding="async" draggable={false} />
        </div>
      ))}
      <div className="sv-vortex-core" />
      <div className="sv-vignette" />
    </div>
  );
}
