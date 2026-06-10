// One-shot particle "explosion" burst rendered on a throwaway full-screen
// canvas. Used by the Generate review screen's Continue button to launch the
// render with a celebratory blast as the screen transitions.

export function playExplosion(cx: number, cy: number, done?: () => void): void {
  if (typeof window === 'undefined') { done?.(); return; }
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (reduced) { done?.(); return; }

  const canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:99999';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); done?.(); return; }
  ctx.scale(dpr, dpr);

  const COLORS = ['#ffffff', '#ffd86b', '#ff8ada', '#8ab4ff', '#7cffb2'];
  const COUNT = 110;
  type P = { x: number; y: number; vx: number; vy: number; life: number; size: number; c: string };
  const parts: P[] = Array.from({ length: COUNT }, () => {
    const a = Math.random() * Math.PI * 2;
    const sp = 4 + Math.random() * 11;
    return {
      x: cx, y: cy,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 1,
      size: 2 + Math.random() * 3.5,
      c: COLORS[(Math.random() * COLORS.length) | 0],
    };
  });

  let flash = 1;
  const start = performance.now();
  let calledDone = false;
  const finish = () => { if (calledDone) return; calledDone = true; done?.(); };

  const frame = () => {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    // Expanding flash ring.
    if (flash > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, (1 - flash) * 280 + 16, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${flash * 0.45})`;
      ctx.fill();
      flash -= 0.05;
    }

    for (const p of parts) {
      if (p.life <= 0) continue;
      p.vx *= 0.965;
      p.vy = p.vy * 0.965 + 0.16; // drag + gravity
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.014;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * Math.max(0.2, p.life), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (performance.now() - start < 1000) {
      requestAnimationFrame(frame);
    } else {
      canvas.remove();
      finish();
    }
  };
  // Fire the transition callback early (~partway through) so the next screen
  // is already arriving under the still-bursting particles.
  window.setTimeout(finish, 240);
  requestAnimationFrame(frame);
}
