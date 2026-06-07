import { useEffect, useRef } from 'react';

// A small, self-contained glowing particle field for the "Your daily feed"
// popup — drifting, twinkling sparks with additive glow. Dependency-free
// 2D canvas, scoped to its parent, pauses when hidden, honours
// prefers-reduced-motion (renders one calm static frame).
export default function FeedParticles({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0, h = 0;

    const resize = () => {
      const r = parent.getBoundingClientRect();
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);

    const COLORS = ['168,130,255', '99,102,241', '245,200,120', '236,72,153', '255,255,255'];
    const N = 48;
    const parts = Array.from({ length: N }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.28,
      vy: (Math.random() - 0.5) * 0.28 - 0.04,
      r: 1 + Math.random() * 2.4,
      a: Math.random(),
      tw: 0.004 + Math.random() * 0.018,
      c: COLORS[(Math.random() * COLORS.length) | 0],
    }));

    let raf = 0;
    let running = true;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      for (const p of parts) {
        if (!reduce) {
          p.x += p.vx; p.y += p.vy; p.a += p.tw;
          if (p.a > 1 || p.a < 0.12) p.tw *= -1;
          if (p.x < 0) p.x = w; else if (p.x > w) p.x = 0;
          if (p.y < 0) p.y = h; else if (p.y > h) p.y = 0;
        }
        const alpha = reduce ? 0.6 : Math.max(0.12, Math.min(1, p.a));
        const rad = p.r * 6;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
        g.addColorStop(0, `rgba(${p.c},${0.9 * alpha})`);
        g.addColorStop(1, `rgba(${p.c},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      if (running && !reduce) raf = requestAnimationFrame(draw);
    };
    draw();

    const onVis = () => {
      if (document.hidden) { running = false; cancelAnimationFrame(raf); }
      else if (!reduce) { running = true; draw(); }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
