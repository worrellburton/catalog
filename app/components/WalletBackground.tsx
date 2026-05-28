import { useEffect, useRef, memo } from 'react';

/**
 * Wallet background — a dotted mesh wave field on a dark canvas.
 * A regular grid of small dots is displaced vertically by layered
 * sine waves so the whole surface reads as a flowing ribbon
 * suspended in space. Colour shifts from cyan at the top of the
 * grid to green at the bottom (matching the brand value tone),
 * with sparse gold highlights riding the crests.
 *
 * Story arc (scroll-driven, compressed so the short Wallet page
 * reaches saturation by ~25% scroll):
 *   0.00 — calm. Waves shallow; few highlights drift.
 *   1.00 — alive. Amplitude lifts; highlight rate peaks.
 *
 * Events (window-scoped):
 *   wallet:burst  — fires a circular shockwave from a point that
 *                   temporarily lifts dots near the origin.
 *   wallet:payout — paints a 3.2s gold tidal sweep along the
 *                   bottom of the viewport.
 */

interface WalletBackgroundProps {
  scrollEl?: HTMLElement | null;
}

interface Highlight {
  /** 0..1 horizontal position. */
  t: number;
  /** baseY of the row this highlight rides (px in canvas coords). */
  y: number;
  speed: number;
  color: 'green' | 'gold' | 'cyan';
  /** Local phase offset so the highlight tracks the wave shape. */
  phaseOffset: number;
  /** Frequency the highlight inherits from its row. */
  freq: number;
}

interface Shockwave {
  x: number;
  y: number;
  startedAt: number;
}

interface PayoutSweep {
  startedAt: number;
}

const COLS_DESKTOP = 80;
const ROWS_DESKTOP = 36;
const COLS_MOBILE  = 40;
const ROWS_MOBILE  = 22;
const HIGHLIGHT_TARGET_PER_SEC = 1.6;

/** Linear lerp between two color stops. */
function lerpColor(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// Top-of-grid cyan → bottom-of-grid green. Matches the reference.
const CYAN: [number, number, number]  = [56, 189, 248];  // sky-400-ish
const GREEN: [number, number, number] = [34, 197, 94];   // green-500

const WalletBackground = memo(function WalletBackground({ scrollEl }: WalletBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvasInit = canvasRef.current;
    if (!canvasInit) return;
    const ctxInit = canvasInit.getContext('2d', { alpha: true });
    if (!ctxInit) return;
    const canvas: HTMLCanvasElement = canvasInit;
    const ctx: CanvasRenderingContext2D = ctxInit;

    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const isMobile = typeof window !== 'undefined'
      && window.matchMedia?.('(max-width: 768px)').matches;
    const cols = reduceMotion ? 30 : (isMobile ? COLS_MOBILE : COLS_DESKTOP);
    const rows = reduceMotion ? 14 : (isMobile ? ROWS_MOBILE : ROWS_DESKTOP);

    const state = {
      highlights: [] as Highlight[],
      shockwaves: [] as Shockwave[],
      payoutSweep: null as PayoutSweep | null,
      width: 0,
      height: 0,
      dpr: 1,
      lastTime: performance.now(),
      scrollTarget: 0,
      scroll: 0,
      highlightSpawnAccumulator: 0,
    };

    function resize() {
      state.dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      state.width = rect.width;
      state.height = rect.height;
      canvas.width = Math.floor(rect.width * state.dpr);
      canvas.height = Math.floor(rect.height * state.dpr);
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    function updateScroll() {
      const el = scrollEl;
      if (!el) { state.scrollTarget = 0; return; }
      const max = Math.max(1, el.scrollHeight - el.clientHeight);
      state.scrollTarget = Math.min(1, Math.max(0, el.scrollTop / max));
    }
    if (scrollEl) {
      scrollEl.addEventListener('scroll', updateScroll, { passive: true });
      updateScroll();
    }

    function onBurst(e: Event) {
      const detail = (e as CustomEvent).detail as { x?: number; y?: number } | undefined;
      const x = detail?.x ?? state.width / 2;
      const y = detail?.y ?? state.height / 2;
      state.shockwaves.push({ x, y, startedAt: performance.now() });
    }
    function onPayout() {
      state.payoutSweep = { startedAt: performance.now() };
    }
    window.addEventListener('wallet:burst',  onBurst);
    window.addEventListener('wallet:payout', onPayout);

    function easeInOut(t: number): number {
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    /** Vertical wave displacement for a given (col, row) at time t. */
    function waveOffset(col: number, row: number, time: number, ampMul: number, cellW: number, cellH: number, originX: number, originY: number): number {
      const x = col * cellW + originX;
      const y = row * cellH + originY;
      // Two layered sines + a slow modulating phase across rows gives
      // the surface its braided look.
      const a = 14 * Math.sin(x * 0.012 + time * 1.4 + row * 0.18);
      const b = 9  * Math.sin(x * 0.025 - time * 0.9 + row * 0.32);
      let amp = (a + b) * ampMul;
      // Shockwave radial lift.
      for (const sw of state.shockwaves) {
        const dt = (time - sw.startedAt / 1000);
        const r = dt * 360;
        const distance = Math.hypot(x - sw.x, y - sw.y);
        const sigma = 70;
        const ring = Math.exp(-Math.pow(distance - r, 2) / (2 * sigma * sigma));
        amp += 36 * ring * Math.max(0, 1 - dt / 1.4);
      }
      return amp;
    }

    function draw(now: number) {
      const dt = Math.min(48, now - state.lastTime);
      state.lastTime = now;
      const dtSec    = dt / 1000;
      const dtFrames = dt / 16.67;

      state.scroll += (state.scrollTarget - state.scroll) * Math.min(0.18, 0.08 * dtFrames);
      const compressed = Math.min(1, state.scroll / 0.25);
      const eased      = easeInOut(compressed);

      const { width: W, height: H, highlights } = state;
      const t = now / 1000;

      // Dark background base.
      ctx.fillStyle = '#0a0e1a';
      ctx.fillRect(0, 0, W, H);
      // Subtle vignette glow — slight cyan haze top, green haze bottom.
      const v1 = ctx.createRadialGradient(W * 0.3, H * 0.2, 0, W * 0.3, H * 0.2, Math.max(W, H) * 0.6);
      v1.addColorStop(0, 'rgba(56, 189, 248, 0.08)');
      v1.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = v1;
      ctx.fillRect(0, 0, W, H);
      const v2 = ctx.createRadialGradient(W * 0.7, H * 0.85, 0, W * 0.7, H * 0.85, Math.max(W, H) * 0.65);
      v2.addColorStop(0, 'rgba(34, 197, 94, 0.09)');
      v2.addColorStop(1, 'rgba(34, 197, 94, 0)');
      ctx.fillStyle = v2;
      ctx.fillRect(0, 0, W, H);

      // Reap stale shockwaves.
      for (let i = state.shockwaves.length - 1; i >= 0; i--) {
        if ((now - state.shockwaves[i].startedAt) / 1000 > 1.6) {
          state.shockwaves.splice(i, 1);
        }
      }

      // Grid spans the full viewport with a small inset so the mesh
      // bleeds off the edges gracefully.
      const inset = 24;
      const cellW = (W - inset * 2) / (cols - 1);
      const cellH = (H - inset * 2) / (rows - 1);
      const ampMul = 0.7 + 0.7 * eased;

      // Draw dots. Cyan at the top of the grid → green at the bottom.
      // Per-dot alpha tapers near the horizontal edges so the field
      // feels like a soft cloud instead of running flat off-canvas.
      for (let row = 0; row < rows; row++) {
        const rowProgress = row / (rows - 1);
        const color = lerpColor(CYAN, GREEN, rowProgress);
        for (let col = 0; col < cols; col++) {
          const colProgress = col / (cols - 1);
          const offset = waveOffset(col, row, t, ampMul, cellW, cellH, inset, inset);
          const px = inset + col * cellW;
          const py = inset + row * cellH + offset;
          // Horizontal edge fade (cubic) so the grid soft-fades at
          // both sides; row fade keeps top + bottom calm and centre
          // dense.
          const ex = Math.abs(colProgress - 0.5) * 2;
          const exFade = 1 - ex * ex * (3 - 2 * ex);
          const er = Math.abs(rowProgress - 0.5) * 2;
          const erFade = 1 - er * er * (3 - 2 * er) * 0.55;
          const alpha = (0.32 + 0.55 * Math.max(0, exFade)) * Math.max(0, erFade);
          const size = 1.2 + 0.7 * (0.6 + 0.4 * erFade);
          ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
          ctx.beginPath();
          ctx.arc(px, py, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Spawn highlights — bright droplets that ride along a single
      // row's wave.
      const ratePerSec = HIGHLIGHT_TARGET_PER_SEC * (0.8 + 1.4 * eased);
      state.highlightSpawnAccumulator += ratePerSec * dtSec;
      while (state.highlightSpawnAccumulator >= 1 && highlights.length < 14) {
        state.highlightSpawnAccumulator -= 1;
        const row = Math.floor(Math.random() * rows);
        highlights.push({
          t: 0,
          y: inset + row * cellH,
          speed: 0.05 + Math.random() * 0.16,
          color: Math.random() < 0.55 ? 'green' : (Math.random() < 0.5 ? 'cyan' : 'gold'),
          phaseOffset: row * 0.18,
          freq: 0.012,
        });
      }

      for (let i = highlights.length - 1; i >= 0; i--) {
        const h = highlights[i];
        h.t += h.speed * dtSec;
        if (h.t >= 1) { highlights.splice(i, 1); continue; }
        const px = inset + h.t * (W - inset * 2);
        // Sample the wave at the highlight's row so the droplet
        // tracks the local curve.
        const row = Math.round((h.y - inset) / cellH);
        const col = h.t * (cols - 1);
        const offset = waveOffset(col, row, t, ampMul, cellW, cellH, inset, inset);
        const py = h.y + offset;
        const rgb = h.color === 'green' ? '74, 222, 128'
                  : h.color === 'gold'  ? '253, 224, 71'
                  :                       '125, 211, 252';
        const fade = Math.min(1, h.t * 8, (1 - h.t) * 8);
        const glowR = 16 * fade + 4;
        const halo = ctx.createRadialGradient(px, py, 0, px, py, glowR);
        halo.addColorStop(0,    `rgba(${rgb}, ${0.95 * fade})`);
        halo.addColorStop(0.45, `rgba(${rgb}, ${0.35 * fade})`);
        halo.addColorStop(1,    `rgba(${rgb}, 0)`);
        ctx.fillStyle = halo;
        ctx.fillRect(px - glowR, py - glowR, glowR * 2, glowR * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.95 * fade})`;
        ctx.beginPath();
        ctx.arc(px, py, 2.3 * fade + 0.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Payout gold sweep along the bottom.
      if (state.payoutSweep) {
        const elapsed = now - state.payoutSweep.startedAt;
        const duration = 3200;
        if (elapsed >= duration) {
          state.payoutSweep = null;
        } else {
          const tt = elapsed / duration;
          const env = tt < 0.12 ? tt / 0.12
                     : tt > 0.78 ? Math.max(0, (1 - tt) / 0.22)
                     : 1;
          const ribbonY = H - 36;
          const ribbonH = 28;
          const headX = -160 + (W + 320) * easeInOut(tt);
          const baseAlpha = 0.22 * env;
          ctx.fillStyle = `rgba(253, 224, 71, ${baseAlpha})`;
          ctx.fillRect(0, ribbonY, W, ribbonH);
          const sheen = ctx.createLinearGradient(headX - 240, 0, headX + 80, 0);
          sheen.addColorStop(0,    'rgba(253, 224, 71, 0)');
          sheen.addColorStop(0.55, `rgba(253, 224, 71, ${0.6 * env})`);
          sheen.addColorStop(0.85, `rgba(255, 247, 200, ${0.95 * env})`);
          sheen.addColorStop(1,    `rgba(253, 224, 71, 0)`);
          ctx.fillStyle = sheen;
          ctx.fillRect(headX - 240, ribbonY - 6, 320, ribbonH + 12);
          const edge = ctx.createLinearGradient(0, ribbonY - 14, 0, ribbonY + ribbonH);
          edge.addColorStop(0, 'rgba(253, 224, 71, 0)');
          edge.addColorStop(1, `rgba(253, 224, 71, ${0.26 * env})`);
          ctx.fillStyle = edge;
          ctx.fillRect(0, ribbonY - 14, W, ribbonH + 14);
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      window.removeEventListener('wallet:burst', onBurst);
      window.removeEventListener('wallet:payout', onPayout);
      if (scrollEl) scrollEl.removeEventListener('scroll', updateScroll);
    };
  }, [scrollEl]);

  return <canvas ref={canvasRef} className="wallet-bg-canvas" aria-hidden />;
});

export default WalletBackground;
