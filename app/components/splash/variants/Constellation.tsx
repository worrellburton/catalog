// Constellation — products become nodes in a living graph, linked by
// thin threads that brighten with proximity. The field drifts, responds
// to the pointer with a gentle parallax, then converges to frame the
// wordmark before expanding away.
//
// Performance: single Canvas2D, DPR capped at 2, ≤24 nodes so the O(n²)
// link pass is trivial. One RAF loop, fully torn down on unmount. Images
// are only drawn (never read back) so cross-origin tainting is harmless.

import { useEffect, useRef } from 'react';
import type { SplashVariantProps } from '../types';

interface Node {
  x: number; y: number;     // current (normalized 0..1 of min-dimension space → see toPx)
  vx: number; vy: number;
  hx: number; hy: number;   // drift home
  img: HTMLImageElement | null;
  loaded: boolean;
  tint: string;
}

const DPR_CAP = 2;
const LINK_DIST = 0.26;       // link threshold (fraction of field)
const NODE_R = 0.052;         // node radius (fraction of min dimension)

export default function Constellation({ images, phase, replayKey }: SplashVariantProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let raf = 0;
    let running = true;
    let W = 0, H = 0, MIN = 0;
    const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);

    // Build nodes on a loose ring + jitter so the initial frame reads as
    // an organised cloud rather than noise.
    const n = images.length;
    const nodes: Node[] = images.map((url, i) => {
      const a = (i / Math.max(1, n)) * Math.PI * 2;
      const r = 0.22 + ((i * 37) % 100) / 100 * 0.2;
      const hx = 0.5 + Math.cos(a) * r;
      const hy = 0.5 + Math.sin(a) * r * 0.82;
      const img = new Image();
      img.decoding = 'async';
      const node: Node = {
        x: hx, y: hy, vx: 0, vy: 0, hx, hy,
        img, loaded: false,
        tint: `hsl(${(i * 47) % 360} 50% 55%)`,
      };
      img.onload = () => { node.loaded = true; };
      img.src = url;
      return node;
    });

    // Pointer parallax (normalized -1..1 around center). Lerped for smooth.
    let px = 0, py = 0, tpx = 0, tpy = 0;
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      tpx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      tpy = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    };
    canvas.addEventListener('pointermove', onMove, { passive: true });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      W = Math.max(1, rect.width);
      H = Math.max(1, rect.height);
      MIN = Math.min(W, H);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const toPx = (nx: number, ny: number): [number, number] => {
      // Map normalized field (square-ish) onto the actual rect, centered.
      const x = nx * W;
      const y = ny * H;
      return [x, y];
    };

    let t0 = performance.now();
    const draw = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.05, (now - t0) / 1000);
      t0 = now;
      px += (tpx - px) * 0.06;
      py += (tpy - py) * 0.06;

      const ph = phaseRef.current;
      const converge = ph === 'reveal';
      const explode = ph === 'exit';

      ctx.clearRect(0, 0, W, H);

      // Update positions.
      for (const nd of nodes) {
        // gentle orbital drift toward home with curl
        const ang = now * 0.00018 + (nd.hx + nd.hy) * 6;
        const homeX = nd.hx + Math.cos(ang) * 0.015;
        const homeY = nd.hy + Math.sin(ang) * 0.015;
        let tx = homeX, ty = homeY;
        if (converge) {
          // pull toward a tighter ring framing the center logo
          tx = 0.5 + (homeX - 0.5) * 0.72;
          ty = 0.5 + (homeY - 0.5) * 0.72;
        } else if (explode) {
          tx = 0.5 + (nd.hx - 0.5) * 1.9;
          ty = 0.5 + (nd.hy - 0.5) * 1.9;
        }
        nd.vx += (tx - nd.x) * 0.06;
        nd.vy += (ty - nd.y) * 0.06;
        nd.vx *= 0.86; nd.vy *= 0.86;
        nd.x += nd.vx * (dt * 60) * 0.5;
        nd.y += nd.vy * (dt * 60) * 0.5;
      }

      // Links — thin threads, opacity by proximity. Parallax-shifted.
      const parX = px * MIN * 0.03;
      const parY = py * MIN * 0.03;
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const d = Math.hypot(dx, dy);
          if (d > LINK_DIST) continue;
          const a = (1 - d / LINK_DIST) * (explode ? 0.12 : 0.5);
          const [x1, y1] = toPx(nodes[i].x, nodes[i].y);
          const [x2, y2] = toPx(nodes[j].x, nodes[j].y);
          ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(x1 + parX, y1 + parY);
          ctx.lineTo(x2 + parX, y2 + parY);
          ctx.stroke();
        }
      }

      // Nodes — rounded product thumbnails with a soft ring + glow dot.
      const r = NODE_R * MIN;
      for (const nd of nodes) {
        const [cx, cy] = toPx(nd.x, nd.y);
        const x = cx + parX, y = cy + parY;
        ctx.save();
        // glow
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 12;
        // rounded square clip
        const s = r * 2;
        const rad = r * 0.42;
        roundRect(ctx, x - r, y - r, s, s, rad);
        ctx.clip();
        if (nd.loaded && nd.img) {
          ctx.drawImage(nd.img, x - r, y - r, s, s);
        } else {
          ctx.fillStyle = nd.tint;
          ctx.fillRect(x - r, y - r, s, s);
        }
        ctx.restore();
        // hairline border
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        roundRect(ctx, x - r, y - r, r * 2, r * 2, r * 0.42);
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointermove', onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayKey, images]);

  return (
    <div className="sv-constellation-scene">
      <canvas ref={canvasRef} className="sv-constellation-canvas" />
      <div className="sv-vignette" />
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
