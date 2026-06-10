// Sphere Swarm — products distributed on a Fibonacci sphere that spins
// slowly in 3D, then blooms outward (radius grows + fades) as the feed
// takes over. CSS-only: one rotating stage, each tile a static transform.

import { useMemo, type CSSProperties } from 'react';
import type { SplashVariantProps } from '../types';

interface Node { url: string; rotY: number; rotX: number; }

// Even point distribution on a sphere via the golden-angle spiral.
function distribute(urls: string[]): Node[] {
  const n = urls.length;
  const golden = Math.PI * (3 - Math.sqrt(5));
  return urls.map((url, i) => {
    const y = 1 - (i / Math.max(1, n - 1)) * 2; // 1 → -1
    const theta = golden * i;
    // Convert to rotation angles for the CSS transform chain.
    const rotX = Math.asin(Math.max(-1, Math.min(1, y))) * (180 / Math.PI);
    const rotY = (theta * (180 / Math.PI)) % 360;
    return { url, rotY, rotX };
  });
}

export default function SphereSwarm({ images, durationMs, replayKey }: SplashVariantProps) {
  const nodes = useMemo(() => distribute(images), [images]);
  // Spin speed scales gently with duration so it always completes ~1 turn.
  const spin = Math.max(6, durationMs / 1000 + 4);
  return (
    <div className="sv-sphere-scene">
      <div
        className="sv-sphere-stage"
        style={{ ['--spin' as string]: `${spin}s` } as CSSProperties}
      >
        {nodes.map((node, i) => (
          <div
            key={`${i}-${replayKey}`}
            className="sv-sphere-tile"
            style={{
              ['--ry' as string]: `${node.rotY}deg`,
              ['--rx' as string]: `${node.rotX}deg`,
              animationDelay: `${(i % 8) * 40}ms`,
            } as CSSProperties}
          >
            <img src={node.url} alt="" loading="eager" decoding="async" draggable={false} />
          </div>
        ))}
      </div>
      <div className="sv-vignette" />
    </div>
  );
}
