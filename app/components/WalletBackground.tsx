import { useEffect, useRef, memo } from 'react';

const GREEN_PALETTE = [
  '#031910',
  '#062a1c',
  '#0a3d28',
  '#0f5a3a',
  '#22c55e',
];

function drawFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
) {
  ctx.fillStyle = GREEN_PALETTE[0];
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 5; i++) {
    const phase = time * 0.00018 + i * 1.7;
    const cx = w * (0.3 + 0.5 * Math.sin(phase * 0.7 + i));
    const cy = h * (0.3 + 0.5 * Math.cos(phase * 0.55 + i * 0.9));
    const radius = Math.min(w, h) * (0.45 + 0.2 * Math.sin(phase * 0.3 + i));

    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    const color = GREEN_PALETTE[1 + (i % (GREEN_PALETTE.length - 1))];
    gradient.addColorStop(0, color + '70');
    gradient.addColorStop(0.45, color + '30');
    gradient.addColorStop(1, color + '00');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }

  const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.7);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
}

const WalletBackground = memo(function WalletBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let dpr = window.devicePixelRatio || 1;
    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const animate = (time: number) => {
      const rect = canvas.getBoundingClientRect();
      drawFrame(ctx, rect.width, rect.height, time);
      frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="wallet-bg-canvas" aria-hidden />;
});

export default WalletBackground;
