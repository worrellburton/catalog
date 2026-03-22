import { useRef, useEffect, memo } from 'react';

interface AnimatedBackgroundProps {
  variant: number;
  className?: string;
  preview?: boolean;
}

// Each variant defines a set of gradient colors and movement patterns
const variants = [
  { name: 'Midnight Aurora', colors: ['#0a0a2e', '#1a1a4e', '#0d2b45', '#1a3a5c', '#0a1628'] },
  { name: 'Warm Ember', colors: ['#1a0a0a', '#2d1212', '#3d1a0a', '#2a1a12', '#1a0d0a'] },
  { name: 'Ocean Drift', colors: ['#0a1a2e', '#0d2435', '#0a2a3a', '#0d1a2a', '#061420'] },
  { name: 'Forest Mist', colors: ['#0a1a0d', '#0d2412', '#1a2d1a', '#0a1a12', '#061208'] },
  { name: 'Violet Haze', colors: ['#1a0a2e', '#2a1245', '#1d0d35', '#120a2a', '#0d0820'] },
  { name: 'Soft Glow', colors: ['#1a1a1a', '#222228', '#1e1e24', '#1a1a20', '#16161c'] },
];

function drawFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  colors: string[],
) {
  // Create smooth moving gradient blobs
  ctx.clearRect(0, 0, w, h);

  // Base fill
  ctx.fillStyle = colors[0];
  ctx.fillRect(0, 0, w, h);

  // Draw 4 moving radial gradients
  for (let i = 0; i < 4; i++) {
    const phase = time * 0.0003 + i * 1.5;
    const cx = w * (0.3 + 0.4 * Math.sin(phase * 0.7 + i));
    const cy = h * (0.3 + 0.4 * Math.cos(phase * 0.5 + i * 0.8));
    const radius = Math.min(w, h) * (0.4 + 0.15 * Math.sin(phase * 0.3));

    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    const color = colors[1 + (i % (colors.length - 1))];
    gradient.addColorStop(0, color + '60');
    gradient.addColorStop(0.5, color + '30');
    gradient.addColorStop(1, color + '00');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }
}

const AnimatedBackground = memo(function AnimatedBackground({ variant, className = '', preview = false }: AnimatedBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const colors = variants[variant]?.colors || variants[0].colors;

    const resize = () => {
      const dpr = preview ? 1 : window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };

    resize();
    if (!preview) {
      window.addEventListener('resize', resize);
    }

    const animate = (time: number) => {
      const rect = canvas.getBoundingClientRect();
      drawFrame(ctx, rect.width, rect.height, time, colors);
      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameRef.current);
      if (!preview) {
        window.removeEventListener('resize', resize);
      }
    };
  }, [variant, preview]);

  return (
    <canvas
      ref={canvasRef}
      className={`animated-bg ${className}`}
      style={{
        position: preview ? 'absolute' : 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: preview ? 0 : -1,
        pointerEvents: 'none',
      }}
    />
  );
});

export { variants };
export default AnimatedBackground;
