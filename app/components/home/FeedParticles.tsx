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

    // Grayscale only — subtle silver dust, no rainbow glow (kept minimal).
    const COLORS = ['255,255,255', '200,200,205', '160,162,168'];
    const N = 26;
    const parts = Array.from({ length: N }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.28,
      vy: (Math.random() - 0.5) * 0.28 - 0.04,
      r: 1 + Math.random() * 2.4,
      a: Math.random(),
      tw: 0.004 + Math.random() * 0.018,
      c: COLORS[(Math.random() * COLORS.length) | 0],
      z: Math.random(),   // depth 0 (far) .. 1 (near)
    }));

    let raf = 0;
    let running = true;
    const start = performance.now();
    const draw = () => {
      // Whole field fades in over ~900ms on load.
      const fade = reduce ? 1 : Math.min(1, (performance.now() - start) / 900);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      for (const p of parts) {
        // Depth: near particles drift faster (parallax), loom larger, and read
        // brighter; far ones move less, shrink, and dim (depth fog).
        const depthMove = 0.4 + p.z;
        const depthScale = 0.6 + 0.9 * p.z;
        const fog = 0.35 + 0.65 * p.z;
        if (!reduce) {
          p.x += p.vx * depthMove; p.y += p.vy * depthMove; p.a += p.tw;
          if (p.a > 1 || p.a < 0.12) p.tw *= -1;
          if (p.x < 0) p.x = w; else if (p.x > w) p.x = 0;
          if (p.y < 0) p.y = h; else if (p.y > h) p.y = 0;
        }
        const alpha = (reduce ? 0.6 : Math.max(0.12, Math.min(1, p.a))) * fog * fade;
        const rad = p.r * 6 * depthScale;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
        g.addColorStop(0, `rgba(${p.c},${0.9 * alpha})`);
        g.addColorStop(1, `rgba(${p.c},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      // Keep looping while motion is on, or until the fade-in finishes.
      if (running && (!reduce || fade < 1)) raf = requestAnimationFrame(draw);
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
